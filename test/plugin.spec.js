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

 const expect = require('chai').expect;
const sinon = require('sinon');

const CloudwatchPolicyPlugin = require('../plugin');

describe('Serverless CloudWatch Plugin', () => {
    let configMock;
    let providerMock;
    let serverlessMock;
    let compiledCloudFormationTemplate;

    let stackName;

    beforeEach(() => {
        // 2 LogGroups, 2 Functions
        compiledCloudFormationTemplate = {
            Resources: {
                FirstLogGroup: {
                    Type: 'AWS::Logs::LogGroup',
                    Properties: {
                        LogGroupName: '/aws/lambda/first-log-group'
                    }
                },
                SecondLogGroup: {
                    Type: 'AWS::Logs::LogGroup',
                    Properties: {
                        LogGroupName: '/aws/lambda/second-log-group'
                    }
                },
                FirstFunction: {
                    Type: 'AWS::Lambda::Function',
                    DependsOn: [
                        'FirstLogGroup',
                        'LambdaExecutionRole',
                    ]
                },
                SecondFunction: {
                    Type: 'AWS::Lambda::Function',
                    DependsOn: [
                        'SecondLogGroup',
                        'LambdaExecutionRole',
                    ]
                }
            },
        };

        configMock = {
            retainLogs: true,
        };

        stackName = 'mock-test-stack';

        providerMock = {
            naming: {
                getStackName: () => stackName,
            },
            request: sinon.stub().throws('Error: Unmocked Service Request'), // By default, error if the service request isn't mocked
        };

        serverlessMock = {
            getProvider: () => providerMock,
            service: {
                provider: {
                    name: 'aws',
                    compiledCloudFormationTemplate,
                },
                custom: {
                    cloudwatchPolicy: configMock,
                }
            },
        };
    });

    async function testNoExistingLogs() {
        // Setup
        // describeLogs has no existing logs
        providerMock.request.withArgs('CloudWatchLogs', 'describeLogGroups', sinon.match.object)
            .returns(Promise.resolve({ logGroups: [] }));

        // Execution
        const plugin = new CloudwatchPolicyPlugin(serverlessMock);
        await plugin.addCloudwatchPolicy();

        // Validation
        const { Resources } = compiledCloudFormationTemplate;
        expect(Resources).to.have.all.keys('FirstLogGroup', 'SecondLogGroup', 'FirstFunction', 'SecondFunction');
        expect(Resources.FirstFunction.DependsOn).to.contain('FirstLogGroup');
        expect(Resources.SecondFunction.DependsOn).to.contain('SecondLogGroup');
        expect(Resources.FirstLogGroup.DeletionPolicy).to.equal('Retain');
        expect(Resources.SecondLogGroup.DeletionPolicy).to.equal('Retain');
    }

    async function testExistingLogs() {
        // Setup
        // describeLogs says FirstLogGroup exists
        providerMock.request.withArgs('CloudWatchLogs', 'describeLogGroups', sinon.match.object)
            .returns(Promise.resolve({
                logGroups: [{
                    logGroupName: '/aws/lambda/first-log-group'
                }]
            }));

        // Execution
        const plugin = new CloudwatchPolicyPlugin(serverlessMock);
        await plugin.addCloudwatchPolicy();

        // Validation
        const { Resources } = compiledCloudFormationTemplate;
        expect(Resources).to.not.have.key('FirstLogGroup');
        expect(Resources).to.have.all.keys('SecondLogGroup', 'FirstFunction', 'SecondFunction');
        expect(Resources.FirstFunction.DependsOn).to.not.contain('FirstLogGroup');
        expect(Resources.SecondFunction.DependsOn).to.contain('SecondLogGroup');
        expect(Resources.SecondLogGroup.DeletionPolicy).to.equal('Retain');
    }

    describe('Initial Stack Creation', () => {
        beforeEach(() => {
            // describeStacks returns a 404 because the stack doesn't exist
            providerMock.request.withArgs('CloudFormation', 'describeStacks', sinon.match.object)
                .returns(Promise.reject({
                    statusCode: 400,
                    providerError: {
                        message: 'Resource does not exist',
                    },
                }));
        });

        it('leaves all references to all LogGroups if none exist', testNoExistingLogs);

        it('removes any pre-existing LogGroups from the Resources', testExistingLogs);
    });

    describe('Stack Update', () => {
        beforeEach(() => {
            // describeStacks returns a valid response
            providerMock.request.withArgs('CloudFormation', 'describeStacks', sinon.match.object)
                .returns(Promise.resolve({
                    statusCode: 200,
                }));
        });

        it('leaves all references to all LogGroups if none exist', testNoExistingLogs);

        it('removes any pre-existing LogGroups from the Resources', testExistingLogs);
    });

    describe('Do not retain', () => {
        beforeEach(() => {
            configMock.retainLogs = false;

            // describeStacks returns a valid response
            providerMock.request.withArgs('CloudFormation', 'describeStacks', sinon.match.object)
                .returns(Promise.resolve({
                    statusCode: 200,
                }));
        });

        it('leaves all references to all LogGroups if none exist', async () => {
            // Setup
            // describeLogs has no existing logs
            providerMock.request.withArgs('CloudWatchLogs', 'describeLogGroups', sinon.match.object)
                .returns(Promise.resolve({ logGroups: [] }));

            // Execution
            const plugin = new CloudwatchPolicyPlugin(serverlessMock);
            await plugin.addCloudwatchPolicy();

            // Validation
            const { Resources } = compiledCloudFormationTemplate;
            expect(Resources).to.have.all.keys('FirstLogGroup', 'SecondLogGroup', 'FirstFunction', 'SecondFunction');
            expect(Resources.FirstFunction.DependsOn).to.contain('FirstLogGroup');
            expect(Resources.SecondFunction.DependsOn).to.contain('SecondLogGroup');
            expect(Resources.FirstLogGroup.DeletionPolicy).to.equal('Delete');
            expect(Resources.SecondLogGroup.DeletionPolicy).to.equal('Delete');
        });

        it('leaves all references to all LogGroups if some exist', async () => {
            // Setup
            // describeLogs says FirstLogGroup exists
            providerMock.request.withArgs('CloudWatchLogs', 'describeLogGroups', sinon.match.object)
                .returns(Promise.resolve({
                    logGroups: [{
                        logGroupName: '/aws/lambda/first-log-group'
                    }]
                }));

            // Execution
            const plugin = new CloudwatchPolicyPlugin(serverlessMock);
            await plugin.addCloudwatchPolicy();

            // Validation
            const { Resources } = compiledCloudFormationTemplate;
            expect(Resources).to.have.all.keys('FirstLogGroup', 'SecondLogGroup', 'FirstFunction', 'SecondFunction');
            expect(Resources.FirstFunction.DependsOn).to.contain('FirstLogGroup');
            expect(Resources.SecondFunction.DependsOn).to.contain('SecondLogGroup');
            expect(Resources.FirstLogGroup.DeletionPolicy).to.equal('Delete');
            expect(Resources.SecondLogGroup.DeletionPolicy).to.equal('Delete');
        });
    });
});
