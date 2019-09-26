/**
 *   Copyright 2019 Cornerstone OnDemand
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

/**
 * Custom Config Options
 *
 * custom:
 *   cloudwatch-policy:
 *     retainLogs: true (default false)
 *
 * retainLogs is used to tell CloudWatch whether or not to retain the logs on stack delete. If true, logs are retained on stack delete.
 * if we are retaining logs on delete, we don't want to continue attempting to manage them after our initial deploy.
 * this plugin will remove the logs and their references once they have been deploy, and set the DeletionPolicy properly
 */
class CloudwatchPolicyPlugin {
    constructor(serverless) {
        this.sls = serverless;
        this.provider = this.sls.getProvider(this.sls.service.provider.name);
        this.config = this.sls.service.custom['cloudwatchPolicy'] || {};

        this.commands = {};
        this.hooks = {
            'before:package:finalize': () => this.addCloudwatchPolicy(),
        };
    }

    _removeDuplicateLogGroups(logGroups) {
        const stackName = this.provider.naming.getStackName();

        const logGroupLookup = {};
        logGroups.forEach(([key, group]) => {
            logGroupLookup[group.Properties.LogGroupName] = key;
        });

        return this.provider.request('CloudWatchLogs', 'describeLogGroups', {
            logGroupNamePrefix: `/aws/lambda/${stackName}`,
        }).then(existingLogs => {
            let duplicateKeys = new Set();

            (existingLogs.logGroups || []).forEach(group => {
                if (group.logGroupName in logGroupLookup) {
                    duplicateKeys.add(logGroupLookup[group.logGroupName]);
                }
            });

            return duplicateKeys;
        }).then(duplicates => {
            // Remove all references to the keys from the various resources, etc
            const { Resources = {} } = this.sls.service.provider.compiledCloudFormationTemplate;
            for (let key of Object.keys(Resources)) {
                if (duplicates.has(key)) {
                    delete Resources[key];
                } else {
                    const res = Resources[key];
                    if (res.DependsOn && res.DependsOn.filter) {
                        res.DependsOn = res.DependsOn.filter(d => !duplicates.has(d));
                    }
                }
            }
        });
    }

    addCloudwatchPolicy() {
        const { retainLogs = false } = this.config;

        // This plugin is only valid for AWS as a provider
        if (this.sls.service.provider.name !== 'aws') {
            return Promise.reject('Cannot add Cloudwatch Policy to non-aws provider');
        }

        const logGroups = [];
        const { Resources = {} } = this.sls.service.provider.compiledCloudFormationTemplate;
        for (let key of Object.keys(Resources)) {
            const res = Resources[key];
            if (res.Type === 'AWS::Logs::LogGroup') {
                logGroups.push([key, res]);
            }
        }

        const stackName = this.provider.naming.getStackName();

        return this.provider.request('CloudFormation', 'describeStacks', {
            StackName: stackName,
        })
        .catch(error => {
            if (error.statusCode === 400 && error.providerError && error.providerError.message.includes('does not exist')) {
                // First creation, this is OK
                return Promise.resolve();
            }

            // Otherwise, pass the error on
            return Promise.reject(error);
        })
        .then(() => retainLogs && this._removeDuplicateLogGroups(logGroups))
        .then(() => {
            // Add our retention policy to the CF Template
            logGroups.forEach(([_, log]) => {
                log.DeletionPolicy = retainLogs ? 'Retain' : 'Delete';
            });
        });
    }
}

module.exports = CloudwatchPolicyPlugin;
