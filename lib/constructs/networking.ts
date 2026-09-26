import {
  CfnEIP,
  CfnInternetGateway,
  CfnNatGateway,
  CfnVPCGatewayAttachment,
  IPeer,
  IVpc,
  Port,
  PrivateSubnet,
  PublicSubnet,
  SecurityGroup,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { CfnOutput, Stack, StackProps } from "aws-cdk-lib/core";

interface NetworkingProps extends StackProps {
  vpcId?: string;
}

interface SubnetConfig {
  type: "public" | "private" | "private_with_egress";
  id: string;
  availabilityZone: string;
  cidrBlock: string;
  vpcId: string;
}

interface SecurityConfig {
  name: string;
  vpc: IVpc;
  description?: string;
  allowAllOutbound?: boolean;
}

interface SecurityRule {
  peer: IPeer;
  port: Port;
  description?: string;
  remoteRule?: boolean;
}

interface SecurityRulesConfig {
  ingress?: SecurityRule[];
  egress?: SecurityRule[];
}

interface NatGatewayConfig {
  name: string;
  vpcId: string;
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
}

export function networking(
  stack: Stack,
  props?: NetworkingProps,
): {
  vpc: () => IVpc;
  subnet: (config: SubnetConfig) => PublicSubnet | PrivateSubnet;
  natGateway: (config: NatGatewayConfig) => CfnNatGateway;
  security: (
    config: SecurityConfig,
    rules?: SecurityRulesConfig,
  ) => SecurityGroup;
} {
  // Example: const defaultVpc = vpc();
  const vpc = (): IVpc => {
    const vpcId =
      props?.vpcId ?? stack.node.tryGetContext("vpcId") ?? process.env.VPC_ID;

    return Vpc.fromLookup(stack, "Vpc", {
      vpcId,
    });
  };

  let internetGateway: CfnInternetGateway | undefined;
  let gatewayAttachment: CfnVPCGatewayAttachment | undefined;

  const ensureInternetGateway = (vpcId: string) => {
    internetGateway ??= new CfnInternetGateway(stack, "InternetGateway");
    gatewayAttachment ??= new CfnVPCGatewayAttachment(
      stack,
      "VpcGatewayAttachment",
      {
        vpcId,
        internetGatewayId: internetGateway.ref,
      },
    );

    return { internetGateway, gatewayAttachment };
  };

  // Example: const publicSubnet = subnet({ type: "public", id: "PublicSubnet", availabilityZone: stack.availabilityZones[0], cidrBlock: "10.0.1.0/24", vpcId: defaultVpc.vpcId });
  const subnet = ({
    type,
    id,
    availabilityZone,
    cidrBlock,
    vpcId,
  }: SubnetConfig): PublicSubnet | PrivateSubnet => {
    switch (type) {
      case "public": {
        const publicSubnet = new PublicSubnet(stack, id, {
          vpcId: vpcId,
          availabilityZone,
          cidrBlock,
          mapPublicIpOnLaunch: true,
        });
        const { internetGateway, gatewayAttachment } =
          ensureInternetGateway(vpcId);
        publicSubnet.addDefaultInternetRoute(
          internetGateway.ref,
          gatewayAttachment,
        );

        return publicSubnet;
      }
      case "private":
      case "private_with_egress":
        return new PrivateSubnet(stack, id, {
          vpcId: vpcId,
          availabilityZone,
          cidrBlock,
          mapPublicIpOnLaunch: false,
        });
    }
  };

  // Example: const nat = natGateway({ name: "NatGateway", publicSubnet, privateSubnet });
  const natGateway = ({
    name,
    vpcId,
    publicSubnet,
    privateSubnet,
  }: NatGatewayConfig): CfnNatGateway => {
    const eip = new CfnEIP(stack, `${name}Eip`, {
      domain: "vpc",
    });

    // The NAT gateway itself lives in the public subnet so it can use this
    // Elastic IP and reach the internet through the internet gateway.
    const gateway = new CfnNatGateway(stack, name, {
      subnetId: publicSubnet.subnetId,
      allocationId: eip.attrAllocationId,
    });

    const { gatewayAttachment } = ensureInternetGateway(vpcId);
    gateway.addResourceDependency(gatewayAttachment);
    // This adds a default outbound route from the private subnet to the NAT
    // gateway. It lets private instances initiate internet connections, but it
    // does not allow unsolicited inbound traffic from the internet.
    privateSubnet.addDefaultNatRoute(gateway.ref);

    return gateway;
  };

  // Example: const webSg = security({ name: "WebSecurityGroup", vpc: defaultVpc }, { ingress: [{ peer: Peer.anyIpv4(), port: Port.tcp(80), description: "Allow HTTP" }] });
  const security = (
    { name, vpc, description, allowAllOutbound }: SecurityConfig,
    rules: SecurityRulesConfig = {},
  ): SecurityGroup => {
    const securityGroup = new SecurityGroup(stack, name, {
      vpc,
      description:
        description ?? "Security group for AutoScalingGroup instances",
      allowAllOutbound: allowAllOutbound ?? true,
    });

    for (const rule of rules.ingress ?? []) {
      securityGroup.addIngressRule(
        rule.peer,
        rule.port,
        rule.description,
        rule.remoteRule,
      );
    }

    for (const rule of rules.egress ?? []) {
      securityGroup.addEgressRule(
        rule.peer,
        rule.port,
        rule.description,
        rule.remoteRule,
      );
    }

    return securityGroup;
  };

  return {
    vpc,
    subnet,
    natGateway,
    security,
  };
}
