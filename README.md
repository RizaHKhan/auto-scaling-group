# EC2 Web + DB Test Stack

This repo creates simple EC2-based infrastructure with a public web node and a separate database node. The web node runs Apache/PHP and the DB node runs PostgreSQL.

## Useful AWS CLI Commands

```bash
# List subnets
aws ec2 describe-subnets \
  --query "Subnets[].{SubnetId:SubnetId,AZ:AvailabilityZone,CIDR:CidrBlock,PublicIpOnLaunch:MapPublicIpOnLaunch,VpcId:VpcId}" \
  --output table

# List EFS file systems, if using EFS
aws efs describe-file-systems \
  --query "FileSystems[].{Id:FileSystemId,Name:Name,MountTargets:NumberOfMountTargets,StackId:Tags[?Key=='aws:cloudformation:stack-id'].Value | [0]}" \
  --output table
```

## Connect to Instances

Use Session Manager when possible:

```bash
aws ssm start-session --target <instance-id>
```

The EC2 helper attaches `AmazonSSMManagedInstanceCore` and the stack installs/enables `amazon-ssm-agent` in user data.

## Quick PHP + PostgreSQL Test

Use this instead of Joomla for a fast end-to-end test: PHP on the web node connects to PostgreSQL on the DB node and runs `SELECT now()`.

### 1. Configure PostgreSQL on the DB Node

Connect to the DB node and run:

```bash
sudo dnf install -y postgresql15-server postgresql15
sudo postgresql-setup --initdb

sudo sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = '*'/" /var/lib/pgsql/data/postgresql.conf

# Replace 10.0.1.0/24 with the web node subnet CIDR if different.
echo "host testdb testuser 10.0.1.0/24 md5" | sudo tee -a /var/lib/pgsql/data/pg_hba.conf

sudo systemctl enable --now postgresql

sudo -iu postgres psql -c "CREATE USER testuser WITH PASSWORD 'testpass';"
sudo -iu postgres createdb -O testuser testdb
```

Get the DB node private IP:

```bash
hostname -I | awk '{print $1}'
```

### 2. Create the PHP Test App on the Web Node

Connect to the web node and install Apache/PHP/Postgres extension:

```bash
sudo dnf install -y httpd php php-pgsql
sudo systemctl enable --now httpd
```

Create `/var/www/html/index.php`. This example uses the DB node private IP you found above, `10.0.1.135`:


```bash
sudo tee /var/www/html/index.php > /dev/null <<'PHP'
<?php
$host = '10.0.2.50';
$db   = 'testdb';
$user = 'testuser';
$pass = 'testpass';
$port = '5432';

$conn = pg_connect("host=$host port=$port dbname=$db user=$user password=$pass");

if (!$conn) {
    http_response_code(500);
    echo "DB connection failed\n";
    exit;
}

$result = pg_query($conn, "SELECT now() AS db_time");
$row = pg_fetch_assoc($result);

echo "PHP app connected to Postgres successfully<br>";
echo "Database time: " . htmlspecialchars($row['db_time']) . "<br>";
PHP
```

Open the web node URL in a browser. Success looks like:

```text
PHP app connected to Postgres successfully
Database time: ...
```

## Security Group Notes

The DB security group should allow PostgreSQL only from the web security group:

```text
source: WebSecurityGroup
port: 5432
protocol: TCP
```

Your local machine should not need direct DB access. Connect to the web node first, then test connectivity from web to DB.

## Optional: Joomla Manual Install

If you want to test Joomla later, install the PHP extensions and unzip Joomla on the web node:

```bash
sudo dnf update -y
sudo dnf install -y httpd php php-pgsql php-xml php-mbstring php-gd php-intl php-zip unzip
sudo systemctl enable --now httpd

cd /tmp
curl -L 'https://downloads.joomla.org/cms/joomla5/5-3-4/Joomla_5-3-4-Stable-Full_Package.zip?format=zip' -o joomla.zip

sudo rm -rf /var/www/html/*
sudo unzip -q joomla.zip -d /var/www/html
sudo chown -R apache:apache /var/www/html
sudo find /var/www/html -type d -exec chmod 755 {} \;
sudo find /var/www/html -type f -exec chmod 644 {} \;
```

Use the DB values from the quick test or create a separate Joomla database/user.
