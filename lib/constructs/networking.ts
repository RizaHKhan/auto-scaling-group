import {
  IVpc,
  PrivateSubnet,
  PublicSubnet,
  Subnet,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Stack, StackProps } from "aws-cdk-lib/core";

interface NetworkingProps extends StackProps {
  vpcId?: string;
}

export function networking(
  stack: Stack,
  props?: NetworkingProps,
): {
  vpc: IVpc;
  publicSubnets: PublicSubnet[];
  privateSubnets: PrivateSubnet[];
} {
  const vpcId =
    props?.vpcId ?? stack.node.tryGetContext("vpcId") ?? process.env.VPC_ID;

  const vpc = Vpc.fromLookup(stack, "Vpc", {
    vpcId,
  });

  const publicSubnets: PublicSubnet[] = [];
  const privateSubnets: PrivateSubnet[] = [];

  publicSubnets.push(
    new PublicSubnet(stack, "PublicSubnet1", {
      vpcId: vpc.vpcId,
      availabilityZone: stack.availabilityZones[0],
      cidrBlock: "10.0.1.0/24",
      mapPublicIpOnLaunch: true,
    }),
  );

  publicSubnets.push(
    new PublicSubnet(stack, "PublicSubnet2", {
      vpcId: vpc.vpcId,
      availabilityZone: stack.availabilityZones[1],
      cidrBlock: "10.0.2.0/24",
      mapPublicIpOnLaunch: true,
    }),
  );

  privateSubnets.push(
    new PrivateSubnet(stack, "PrivateSubnet1", {
      vpcId: vpc.vpcId,
      availabilityZone: stack.availabilityZones[0],
      cidrBlock: "10.0.3.0/24",
      mapPublicIpOnLaunch: false,
    }),
  );

  privateSubnets.push(
    new PrivateSubnet(stack, "PrivateSubnet2", {
      vpcId: vpc.vpcId,
      availabilityZone: stack.availabilityZones[1],
      cidrBlock: "10.0.4.0/24",
      mapPublicIpOnLaunch: false,
    }),
  );

  return { vpc, publicSubnets, privateSubnets };
}
