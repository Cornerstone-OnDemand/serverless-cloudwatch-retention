# Serverless CloudWatch Retention

This plugin is designed to let you manipulate the retention for your CloudWatch Logs in AWS.

## The Problem

Serverless does not provide a native way to set the `DeletionPolicy` on CloudWatch logs. This plugin adds that capability.
If you set your CloudWatch logs to be retained, you can no longer `remove` and re`deploy` your serverless application with either 1) changing the service name, or 2) manualling deleting the logs you want to retain.

This is a particular problem for CI/CD pipelines that like to set up and tear down the service repeatedly for testing purposes, if you want to keep the logs around to debug test failures, etc.

## The Solution

We hook in just before serverless generates the CloudFormation template to manipulate the CloudWatch Resources, etc.
For every deploy, we do the following steps:
1. Check for any LogGroups that exist with the prefix of '/aws/lambda/{serviceName}'. These are the log groups that the Lambda functions will automatically use for their logging. They are also managed via this template.
2. If any LogGroups exist in AWS and the CloudFormation template, then we remove the LogGroup entry and any `DependsOn` references from the managed Resources
3. Add `DeletionPolicy: 'retain'` to any remaining LogGroups

The first deploy of a given services (or a new lambda) will include the LogGroup entry to make sure the group is properly created. On subsequent deploys, the LogGroups are removed from the CloudFormation Template. Removing the entry makes CloudFormation attempt to remove the LogGroups, but since they are set to retain on delete, they are simply removed from CloudFormation management and will persist until manually deleted.

# Using

## Installation

1. Checkout this repo to a standardized location
2. Update the `plugins` section of your serverless.yml as outlined below
    ```yaml
    plugins:
        localPath: '<path to the parent directory of your local checkout>'
        modules:
            - <normal includes for the other plugins>
            - serverless-cloudwatch-retention // <-- the reference to this plugin
    ```

## Configuration

We need to add the plugin-specific config items to the custom section of our serverless config

```yaml
custom:
    cloudwatchPolicy:
        retainLogs: true
```

Now you can use `serverless deploy` as you normally would and your logs will be properly managed should you have to remove your service.
