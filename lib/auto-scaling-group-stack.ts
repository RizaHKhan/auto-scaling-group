import { AutoScalingGroup, UpdatePolicy } from "aws-cdk-lib/aws-autoscaling";
import {
  CfnEIP,
  CfnInternetGateway,
  CfnNatGateway,
  CfnVPCGatewayAttachment,
  InstanceClass,
  InstanceSize,
  InstanceType,
  LaunchTemplate,
  MachineImage,
  SecurityGroup,
  UserData,
} from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { StackProps, Stack, Duration } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { networking } from "./constructs/";

export interface AutoScalingGroupStackProps extends StackProps {
  /**
   * The VPC ID to deploy the Auto Scaling Group into.
   * Can be passed via props, CDK context (-c vpcId=vpc-xxx), or VPC_ID env var.
   *
   * @default - context 'vpcId', process.env.VPC_ID, or 'vpc-0918d046dfe2ddafa'
   */
  readonly vpcId?: string;
}

export class AutoScalingGroupStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: AutoScalingGroupStackProps,
  ) {
    super(scope, id, props);

    const { vpc, privateSubnets, publicSubnets } = networking(this);

    const internetGateway = new CfnInternetGateway(this, "InternetGateway");
    const gatewayAttachment = new CfnVPCGatewayAttachment(
      this,
      "VpcGatewayAttachment",
      {
        vpcId: vpc.vpcId,
        internetGatewayId: internetGateway.ref,
      },
    );
    publicSubnets[0].addDefaultInternetRoute(
      internetGateway.ref,
      gatewayAttachment,
    );
    publicSubnets[1].addDefaultInternetRoute(
      internetGateway.ref,
      gatewayAttachment,
    );

    const eip = new CfnEIP(this, "NatEIP", {
      domain: "vpc",
    });

    // Cost vs. HA Trade-off: A single NAT Gateway in publicSubnet1 is sufficient to handle outbound
    // traffic for private subnets across all AZs, saving ~$32/month.
    // For mission-critical production, provision 1 NAT Gateway per AZ to avoid a single point of failure.
    const natGateway = new CfnNatGateway(this, "NatGateway", {
      subnetId: publicSubnets[0].subnetId,
      allocationId: eip.attrAllocationId,
    });
    natGateway.addResourceDependency(gatewayAttachment);

    privateSubnets[0].addDefaultNatRoute(natGateway.ref);
    privateSubnets[1].addDefaultNatRoute(natGateway.ref);

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
      "systemctl restart amazon-ssm-agent",
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

    // Architectural Note: Placing the ASG in private subnets behind an internet-facing
    // ALB is an AWS Well-Architected best practice.
    // Outbound traffic from private subnets routes through the NAT Gateway in publicSubnet1
    // allowing instances to download packages (`dnf install`) and connect to SSM.
    const asg = new AutoScalingGroup(this, "AutoScalingGroup", {
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      launchTemplate,
      minCapacity: 2,
      maxCapacity: 3,
      updatePolicy: UpdatePolicy.rollingUpdate({
        minInstancesInService: 1,
        pauseTime: Duration.minutes(2),
      }),
    });
    asg.node.addDependency(natGateway);

    // AWS ALBs are a managed regional service that deploys load balancer nodes (ENIs)
    // across multiple Availability Zone subnets under a single logical resource and DNS name.
    // AWS strictly requires subnets in at least two AZs for high availability and fault tolerance.
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
