import { StackProps, Stack } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { networking, compute } from "./constructs/";
import {
  Peer,
  Port,
  PrivateSubnet,
  PublicSubnet,
  UserData,
} from "aws-cdk-lib/aws-ec2";

export class AutoScalingGroupStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const { vpc, subnet, natGateway, security } = networking(this);
    const { instance } = compute(this);

    const defaultVpc = vpc();
    const publicSubnet = subnet({
      type: "public",
      id: "PublicSubnet",
      availabilityZone: this.availabilityZones[0],
      cidrBlock: "10.0.1.0/24",
      vpcId: defaultVpc.vpcId,
    }) as PublicSubnet;
    const privateSubnet = subnet({
      type: "private",
      id: "PrivateSubnet",
      availabilityZone: this.availabilityZones[0],
      cidrBlock: "10.0.2.0/24",
      vpcId: defaultVpc.vpcId,
    }) as PrivateSubnet;

    natGateway({
      name: "NatGateway",
      vpcId: defaultVpc.vpcId,
      publicSubnet,
      privateSubnet,
    });

    const webSecurityGroup = security(
      {
        name: "WebSecurityGroup",
        vpc: defaultVpc,
        allowAllOutbound: true,
      },
      {
        ingress: [
          {
            peer: Peer.anyIpv4(),
            port: Port.tcp(80),
            description: "Allow HTTP",
          },
          {
            peer: Peer.anyIpv4(),
            port: Port.tcp(22),
            description: "Allow SSH",
          },
        ],
      },
    );

    const databaseSecurityGroup = security(
      {
        name: "DatabaseSecurityGroup",
        vpc: defaultVpc,
        allowAllOutbound: true,
      },
      {
        ingress: [
          {
            peer: webSecurityGroup,
            port: Port.tcp(5432),
            description: "Allow PostgreSQL only from web instance",
          },
        ],
      },
    );

    instance({
      name: "web",
      vpc: defaultVpc,
      securityGroup: webSecurityGroup,
      userData: (() => {
        const userData = UserData.forLinux();
        userData.addCommands(
          "dnf install -y httpd php amazon-ssm-agent",
          "systemctl enable httpd",
          "systemctl start httpd",
          "systemctl enable amazon-ssm-agent",
          "systemctl restart amazon-ssm-agent",
        );
        return userData;
      })(),
      subnets: publicSubnet,
    });

    instance({
      name: "db",
      vpc: defaultVpc,
      securityGroup: databaseSecurityGroup,
      userData: (() => {
        const userData = UserData.forLinux();
        userData.addCommands(
          "dnf install -y postgresql15-server postgresql15 amazon-ssm-agent",
          "postgresql-setup --initdb",
          "systemctl enable postgresql",
          "systemctl start postgresql",
          "systemctl enable amazon-ssm-agent",
          "systemctl restart amazon-ssm-agent",
        );
        return userData;
      })(),
      subnets: privateSubnet,
    });
  }
}
