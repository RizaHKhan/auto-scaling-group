import { Stack, StackProps } from "aws-cdk-lib/core";
import {
  IRole,
  ManagedPolicy,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  MachineImage,
  SecurityGroup,
  Subnet,
  UserData,
} from "aws-cdk-lib/aws-ec2";

interface ComputeProps extends StackProps {}

interface InstanceConfig {
  name: string;
  vpc: IVpc;
  instanceType?: InstanceType;
  securityGroup?: SecurityGroup;
  subnets?: Subnet | Subnet[];
  userData?: UserData;
  role?: IRole;
  associatePublicIpAddress?: boolean;
}

export function compute(stack: Stack, props: ComputeProps = {}) {
  // Example: const webInstance = instance({ name: "WebInstance", vpc: defaultVpc, securityGroup: webSg, subnets: publicSubnet, userData });
  const instance = ({
    name,
    vpc,
    instanceType,
    securityGroup,
    subnets,
    userData,
    role,
    associatePublicIpAddress,
  }: InstanceConfig): Instance => {
    const selectedSubnets = subnets
      ? Array.isArray(subnets)
        ? subnets
        : [subnets]
      : undefined;
    const vpcSubnets = selectedSubnets ? { subnets: selectedSubnets } : undefined;

    const instanceRole =
      role ??
      new Role(stack, `${name}SsmRole`, {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName(
            "AmazonSSMManagedInstanceCore",
          ),
        ],
      });

    return new Instance(stack, name, {
      vpc,
      vpcSubnets,
      instanceType:
        instanceType ?? InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      machineImage: MachineImage.latestAmazonLinux2023(),
      securityGroup,
      userData,
      role: instanceRole,
      associatePublicIpAddress,
      requireImdsv2: true,
    });
  };

  return { instance };
}
