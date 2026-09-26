# EC2 on Autoscaling groups

## Checklist

### VPC

We need to create or find an existing VPC

```typescript
const vpc = Vpc.fromLookup(this, "Vpc", {
  vpcId: "asdfasdf",
});
```

### Public Subnets

We need 

```typescript
const publicSubnet1 = new PublicSubnet(this, "PublicSubnet1", {
  vpcId: vpc.vpcId,
  availabilityZone: this.availabilityZones[0],
  cidrBlock: "10.0.1.0/24",
  mapPublicIpOnLaunch: true,
});
```

## Diagram

```mermaid
architecture-beta
    group vpc(cloud)[VPC 0.0.0.0/16]
        group asg(server)[Auto Scaling Group: max 2] in vpc
            group az1(cloud)[AZ1] in asg
              group subnet1(cloud)[PublicSubnet1] in az1
                service instance1(logos:aws-ec2)[EC2] in subnet1
            group az2(cloud)[AZ2] in asg
              group subnet2(cloud)[PublicSubnet1] in az2
                service instance2(logos:aws-ec2)[EC2] in subnet2
          
align column instance1 instance2
```
