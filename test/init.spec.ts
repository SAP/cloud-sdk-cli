/*!
 * Copyright (c) 2020 SAP SE or an SAP affiliate company. All rights reserved.
 */

jest.mock('../src/utils/warnings');

import execa = require('execa');
import * as fs from 'fs-extra';
import * as path from 'path';
import Init from '../src/commands/init';
import { getWarnings, recordWarning } from '../src/utils/warnings';
import { deleteAsync, getCleanProjectDir, getTestOutputDir } from './test-utils';

const testOutputDir = getTestOutputDir(__filename);
const expressAppDir = path.resolve('test', 'express');
const nestAppDir = path.resolve('test', 'nest');

jest.retryTimes(3);

describe('Init', () => {
  beforeAll(() => {
    rm.sync(testOutputDir);
  });

  afterAll(() => {
    rm.sync(testOutputDir);
  });

  it('should add necessary files to an existing project', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-to-existing');
    fs.copySync(expressAppDir, projectDir, { recursive: true });

    await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--no-analytics', '--skipInstall', '--force']);

    ['.npmrc', 'credentials.json', 'systems.json', 'manifest.yml']
      .map(file => path.resolve(projectDir, file))
      .forEach(path => {
        expect(fs.existsSync(path)).toBe(true);
      });
    expect(fs.existsSync(path.resolve(projectDir, 'test'))).toBe(false);
  });

  it('should add necessary files to an existing project when adding cds', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-to-existing');
    fs.copySync(expressAppDir, projectDir, { recursive: true });

    await Init.run([projectDir, '--projectName=testingApp', '--addCds', '--startCommand="npm start"', '--no-analytics', '--skipInstall', '--force']);

    ['.cdsrc.json', 'srv/cat-service.cds', 'db/data-model.cds']
      .map(file => path.resolve(projectDir, file))
      .forEach(path => {
        expect(fs.existsSync(path)).toBe(true);
      });
  });

  it('init should detect and fail if there are conflicts', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'detect-conflicts');
    fs.copySync(nestAppDir, projectDir, { recursive: true });
    fs.createFileSync(`${projectDir}/.npmrc`);

    try {
      await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--skipInstall', '--no-analytics']);
    } catch (e) {
      expect(e.message).toMatch(/A file with the name .* already exists\./);
    }
  });

  it('should add to .gitignore if there is one', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-to-gitignore');
    fs.copySync(nestAppDir, projectDir, { recursive: true });

    await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--skipInstall', '--no-analytics']);

    const gitignoreEntries = fs
      .readFileSync(`${projectDir}/.gitignore`, 'utf8')
      .split('\n')
      .filter(entry => entry !== '');

    expect(gitignoreEntries).toIncludeAllMembers(['credentials.json', '/s4hana_pipeline', '/deployment']);
    expect(gitignoreEntries.length).toBeGreaterThan(29);
  });

  it('should show a warning if the project is not using git', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'warn-on-no-git');

    fs.createFileSync(path.resolve(projectDir, 'package.json'));
    fs.writeFileSync(path.resolve(projectDir, 'package.json'), JSON.stringify({ name: 'project' }), 'utf8');

    await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--skipInstall', '--no-analytics']);

    expect(recordWarning).toHaveBeenCalledWith(
      'No .gitignore file found!',
      'If your project is using a different version control system,',
      'please make sure the following paths are not tracked:',
      '  credentials.json',
      '  /s4hana_pipeline',
      '  /deployment'
    );
    expect(getWarnings).toHaveBeenCalled();
  });

  it('should add our scripts and dependencies to the package.json', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-scripts-and-dependencies');
    fs.createFileSync(path.resolve(projectDir, 'package.json'));
    fs.writeFileSync(path.resolve(projectDir, 'package.json'), JSON.stringify({ name: 'project' }), 'utf8');

    await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--frontendScripts', '--skipInstall', '--no-analytics']);

    const packageJson = JSON.parse(fs.readFileSync(path.resolve(projectDir, 'package.json'), 'utf8'));

    const dependencies = Object.keys(packageJson.dependencies);
    const devDependencies = Object.keys(packageJson.devDependencies);
    const scripts = Object.keys(packageJson.scripts);

    expect(dependencies).toContain('@sap-cloud-sdk/core');
    expect(devDependencies).toContain('@sap-cloud-sdk/test-util');
    expect(scripts).toIncludeAllMembers(['ci-build', 'ci-package', 'ci-backend-unit-test', 'ci-frontend-unit-test', 'ci-integration-test', 'ci-e2e']);
  });

  it('should add the analytics file', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-to-gitignore');
    fs.copySync(nestAppDir, projectDir, { recursive: true });

    await Init.run([
      projectDir,
      '--projectName=testingApp',
      '--startCommand="npm start"',
      '--skipInstall',
      '--analytics',
      '--analyticsSalt=SAPCLOUDSDK4LIFE'
    ]);

    expect(JSON.parse(fs.readFileSync(`${projectDir}/sap-cloud-sdk-analytics.json`, 'utf8'))).toEqual({ enabled: true, salt: 'SAPCLOUDSDK4LIFE' });
  }, 10000);

  it('should add a disabled analytics file', async () => {
    const projectDir = getCleanProjectDir(testOutputDir, 'add-to-gitignore');
    fs.copySync(expressAppDir, projectDir, { recursive: true });

    await Init.run([projectDir, '--projectName=testingApp', '--startCommand="npm start"', '--skipInstall', '--no-analytics']);

    expect(JSON.parse(fs.readFileSync(`${projectDir}/sap-cloud-sdk-analytics.json`, 'utf8'))).toEqual({ enabled: false });
  });
});
