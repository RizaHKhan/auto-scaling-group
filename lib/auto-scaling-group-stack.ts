import { AutoScalingGroup, UpdatePolicy } from "aws-cdk-lib/aws-autoscaling";
import {
  CfnInternetGateway,
  CfnVPCGatewayAttachment,
  InstanceClass,
  InstanceSize,
  InstanceType,
  LaunchTemplate,
  MachineImage,
  PublicSubnet,
  SecurityGroup,
  UserData,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AutoScalingGroupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'Vpc', {
      vpcId: 'vpc-0918d046dfe2ddafa',
    });

    // Application Load Balancers require subnets in at least two Availability Zones
    const publicSubnet1 = new PublicSubnet(this, "PublicSubnet1", {
      vpcId: vpc.vpcId,
      availabilityZone: this.availabilityZones[0],
      cidrBlock: "10.0.1.0/24",
      mapPublicIpOnLaunch: true,
    });

    const publicSubnet2 = new PublicSubnet(this, "PublicSubnet2", {
      vpcId: vpc.vpcId,
      availabilityZone: this.availabilityZones[1],
      cidrBlock: "10.0.2.0/24",
      mapPublicIpOnLaunch: true,
    });

    const internetGateway = new CfnInternetGateway(this, "InternetGateway");
    const gatewayAttachment = new CfnVPCGatewayAttachment(this, "VpcGatewayAttachment", {
      vpcId: vpc.vpcId,
      internetGatewayId: internetGateway.ref,
    });
    publicSubnet1.addDefaultInternetRoute(internetGateway.ref, gatewayAttachment);
    publicSubnet2.addDefaultInternetRoute(internetGateway.ref, gatewayAttachment);

    const role = new Role(this, "SSMRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });

    const userData = UserData.forLinux();
    userData.addCommands(
      "dnf update -y",
      "dnf install -y httpd php",
      "systemctl start httpd",
      "systemctl enable httpd",
      "systemctl enable amazon-ssm-agent",
      "systemctl restart amazon-ssm-agent"
    );

    const asgSecurityGroup = new SecurityGroup(this, "AsgSecurityGroup", {
      vpc,
      description: "Security group for AutoScalingGroup instances",
      allowAllOutbound: true,
    });

    const launchTemplate = new LaunchTemplate(this, "LaunchTemplate", {
      machineImage: MachineImage.latestAmazonLinux2023(),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      role,
      requireImdsv2: true,
      userData,
      securityGroup: asgSecurityGroup,
    });

    const asg = new AutoScalingGroup(this, "AutoScalingGroup", {
      vpc,
      vpcSubnets: {
        subnets: [publicSubnet1, publicSubnet2],
      },
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 2,
      updatePolicy: UpdatePolicy.rollingUpdate({
        minInstancesInService: 1,
        pauseTime: cdk.Duration.minutes(2),
      }),
    });

    const lb = new ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnets: [publicSubnet1, publicSubnet2],
      },
    });

    const listener = lb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    listener.addTargets("TargetFleet", {
      port: 80,
      targets: [asg],
      healthCheck: {
        path: "/",
        interval: cdk.Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        timeout: cdk.Duration.seconds(5),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: `http://${lb.loadBalancerDnsName}`,
      description: "Public URL of the Application Load Balancer",
    });
  }
}
