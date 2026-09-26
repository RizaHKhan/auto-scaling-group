import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib/core";
import { ISecurityGroup, ISubnet, IVpc } from "aws-cdk-lib/aws-ec2";
import { FileSystem, PerformanceMode, ThroughputMode } from "aws-cdk-lib/aws-efs";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
} from "aws-cdk-lib/aws-rds";

interface StorageProps extends StackProps {
  vpc: IVpc;
  subnets: ISubnet[];
  allowedSecurityGroup?: ISecurityGroup;
}

interface RdsProps {
  clusterIdentifier?: string;
  databaseName?: string;
}

export function storage(stack: Stack, props: StorageProps) {
  const rds = (rdsProps: RdsProps = {}) => {
    const databaseName = rdsProps.databaseName ?? "joomla";
    const cluster = new DatabaseCluster(stack, "Database", {
      clusterIdentifier: rdsProps.clusterIdentifier ?? "database-1",
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_17_9,
      }),
      // The writer is the primary Aurora instance that accepts writes. Using
      // serverlessV2 makes that writer scale ACUs automatically instead of
      // pinning it to a fixed DB instance class.
      writer: ClusterInstance.serverlessV2("writer"),
      credentials: Credentials.fromGeneratedSecret("postgres"),
      defaultDatabaseName: databaseName,
      backup: {
        retention: Duration.days(1),
      },
      deleteAutomatedBackups: true,
      iamAuthentication: true,
      storageEncrypted: true,
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 16,
      serverlessV2AutoPauseDuration: Duration.seconds(300),
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.subnets,
      },
    });

    if (props.allowedSecurityGroup) {
      cluster.connections.allowDefaultPortFrom(
        props.allowedSecurityGroup,
        "Allow application instances to connect to Postgres",
      );
    }

    new CfnOutput(stack, "DatabaseEndpoint", {
      value: cluster.clusterEndpoint.hostname,
      description: "Aurora PostgreSQL writer endpoint for Joomla",
    });

    new CfnOutput(stack, "DatabaseName", {
      value: databaseName,
      description: "Joomla database name",
    });

    if (cluster.secret) {
      new CfnOutput(stack, "DatabaseCredentialsSecretArn", {
        value: cluster.secret.secretArn,
        description: "Secrets Manager ARN containing the database username and password",
      });
    }

    return cluster;
  };

  const efs = () => {
    const fileSystem = new FileSystem(stack, "JoomlaFileSystem", {
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.subnets,
      },
      encrypted: true,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      throughputMode: ThroughputMode.ELASTIC,
      // Keep manually uploaded Joomla files if the stack is deleted.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    if (props.allowedSecurityGroup) {
      fileSystem.connections.allowDefaultPortFrom(
        props.allowedSecurityGroup,
        "Allow application instances to mount Joomla EFS",
      );
    }

    new CfnOutput(stack, "JoomlaFileSystemId", {
      value: fileSystem.fileSystemId,
      description: "EFS file system mounted at /var/www/html for Joomla files",
    });

    return fileSystem;
  };

  return { rds, efs };
}
