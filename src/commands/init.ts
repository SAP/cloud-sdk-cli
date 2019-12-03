/*!
 * Copyright (c) 2019 SAP SE or an SAP affiliate company. All rights reserved.
 */

import { Command, flags } from '@oclif/command';
import { OutputFlags } from '@oclif/parser';
import cli from 'cli-ux';
import * as execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as rm from 'rimraf';
import { action } from '../utils/cli-action';
import { installDependencies, modifyPackageJson, packageJson } from '../utils/package-json';
import { copyFiles, ensureDirectoryExistence, findConflicts, readTemplates } from '../utils/templates';

type Flags = OutputFlags<typeof Init.flags>;

export default class Init extends Command {
  static description = 'Initializes your project for the SAP Cloud SDK, SAP Cloud Platform Cloud Foundry and CI/CD using the SAP Cloud SDK toolkit';

  static examples = ['$ sap-cloud-sdk init', '$ sap-cloud-sdk init --help'];

  static flags = {
    projectName: flags.string({
      hidden: true,
      description: 'Give project name which is used for the Cloud Foundry mainfest.yml'
    }),
    startCommand: flags.string({
      hidden: true,
      description: 'Give a command which is used to start the application productively.'
    }),
    frontendScripts: flags.boolean({
      hidden: true,
      description: 'Add frontend-related npm scripts which are needed for CI/CD.',
      exclusive: ['skipFrontendScripts']
    }),
    skipFrontendScripts: flags.boolean({
      hidden: true,
      description: 'Skip frontend-related npm scripts and dont ask to add them.',
      exclusive: ['frontendScripts']
    }),
    buildScaffold: flags.boolean({
      hidden: true,
      description: 'If the folder is empty, use nest-cli to create a project scaffold.'
    }),
    projectDir: flags.string({
      description: 'Path to the folder in which the project should be created.'
    }),
    force: flags.boolean({
      hidden: true,
      description: 'Overwrite files without asking if conflicts are found.'
    }),
    help: flags.help({
      char: 'h',
      description: 'Show help for the new command.'
    }),
    verbose: flags.boolean({
      char: 'v',
      description: 'Show more detailed output.'
    })
  };

  static args = [
    {
      name: 'projectDir',
      description: 'Path to the folder in which the project should be created.'
    }
  ];

  async run() {
    const { flags, args } = this.parse(Init);
    const { verbose } = flags;

    if (typeof flags.projectDir !== 'undefined' && typeof args.projectDir !== 'undefined' && flags.projectDir !== args.projectDir) {
      this.error('Project directory was given via argument and via the `--projectDir` flag. Please only provide one.', { exit: 1 });
    }

    const projectDir: string = flags.projectDir || args.projectDir || '.';

    try {
      ensureDirectoryExistence(projectDir, true);

      const buildScaffold = await this.shouldBuildScaffold(projectDir, flags.buildScaffold);
      if (buildScaffold) {
        await action('Building application scaffold', !verbose, this.buildScaffold(projectDir, flags));
      }

      const options = await this.getOptions(projectDir, buildScaffold ? 'npm run start:prod' : flags.startCommand, flags.projectName);

      cli.action.start('Reading templates');
      const files = readTemplates({
        from: [path.resolve(__dirname, '..', 'templates', 'init')],
        to: projectDir
      });
      cli.action.stop();

      cli.log('Finding potential conflicts...');
      await findConflicts(files, flags.force);

      await action('Creating files', true, copyFiles(files, options)).catch(e => this.error(e, { exit: 2 }));

      const addFrontendScripts: boolean =
        flags.frontendScripts || (!flags.skipFrontendScripts && (await cli.confirm('Should frontend-related npm scripts for CI/CD be added?')));
      cli.log('Adding dependencies to package.json...');
      await modifyPackageJson(projectDir, addFrontendScripts, buildScaffold);
      await action('Installing dependencies', !verbose, installDependencies(projectDir, verbose)).catch(e =>
        this.error(`Error during npm install: ${e.message}`, { exit: 2 })
      );

      cli.log('Modify `.gitignore`...');
      this.modifyGitIgnore(projectDir);

      buildScaffold ? this.printSuccessMessageScaffold() : this.printSuccessMessage();
    } catch (error) {
      this.error(error, { exit: 1 });
    }
  }

  private async shouldBuildScaffold(projectDir: string, buildScaffold: boolean) {
    if (buildScaffold) {
      return true;
    }

    if (fs.existsSync(path.resolve(projectDir, 'package.json'))) {
      return false;
    }

    this.log('This folder does not contain a `package.json`.');

    return cli.confirm('Should a new `nest.js` project be initialized in this folder?');
  }

  private async buildScaffold(projectDir: string, { force, verbose }: Flags) {
    if (fs.readdirSync(projectDir).length !== 0) {
      const dirString = projectDir === '.' ? 'this directory' : projectDir;
      if (force || (await cli.confirm(`Directory is not empty. Remove all files in ${dirString}?`))) {
        rm.sync(`${projectDir}/{*,.*}`);
      }
    }

    const cliPath = path.resolve('node_modules/.bin/nest');
    const options: { [key: string]: string } = {
      cwd: projectDir,
      stdio: verbose ? 'inherit' : 'ignore'
    };

    if (fs.existsSync(cliPath)) {
      await execa(cliPath, ['new', '.', '--skip-install', '--package-manager', 'npm'], options);
    } else {
      await execa('npx', ['@nestjs/cli', 'new', '.', '--skip-install', '--package-manager', 'npm'], options);
    }

    const pathToMainTs = path.resolve(projectDir, 'src', 'main.ts');
    const mainTs = fs.readFileSync(pathToMainTs, { encoding: 'utf8' });
    const modifiedMainTs = mainTs.replace('.listen(3000)', '.listen(process.env.PORT || 3000)');

    if (mainTs === modifiedMainTs) {
      cli.warn('Could not adjust listening port to `process.env.PORT`. Please adjust manually.');
    }

    fs.writeFileSync(pathToMainTs, modifiedMainTs);
  }

  private async getOptions(projectDir: string, startCommand?: string, projectName?: string) {
    try {
      const options: { [key: string]: string } = {
        projectName:
          projectName ||
          (await cli.prompt('Enter project name (for use in manifest.yml)', {
            default: packageJson(projectDir).name
          })),
        command:
          startCommand ||
          (await cli.prompt('Enter the command to start your server', {
            default: packageJson(projectDir).scripts.start ? 'npm start' : ''
          }))
      };

      return options;
    } catch (error) {
      this.error('Your package.json does not contain valid JSON. Please repair or delete it.', { exit: 10 });
      return {}; // to satisfy tsc, which does not realize this is unreachable
    }
  }

  private modifyGitIgnore(projectDir: string) {
    const pathToGitignore = path.resolve(projectDir, '.gitignore');
    const pathsToIgnore = ['credentials.json', '/s4hana_pipeline', '/deployment'];

    if (fs.existsSync(pathToGitignore)) {
      try {
        const fileContent = fs.readFileSync(pathToGitignore, 'utf8');
        const newPaths = pathsToIgnore.filter(path => !fileContent.includes(path));
        const newFileContent = fileContent + (newPaths.length ? `\n${newPaths.join('\n')}\n` : '');

        fs.writeFileSync(pathToGitignore, newFileContent, 'utf8');
      } catch (error) {
        this.warn('There was a problem writing to the .gitignore.');
        this.log('If your project is using a different version control system, please make sure the following paths are not tracked:');
        pathsToIgnore.forEach(path => this.log('  ' + path));
      }
    } else {
      this.warn('No .gitignore file found!');
      this.log('If your project is using a different version control system, please make sure the following paths are not tracked:');
    }
  }

  private printSuccessMessage() {
    this.log('+---------------------------------------------------------------+');
    this.log('| ✅ Init finished successfully.                                |');
    this.log('|                                                               |');
    this.log('| 🚀 Next steps:                                                |');
    this.log('| 1. Make sure that your app listens to `process.env.PORT`      |');
    this.log('| 2. Build your app if necessary                                |');
    this.log('| 3. Run `sap-cloud-sdk package [--include INC][--exclude EXC]` |');
    this.log('| 4. Push to Cloud Foundry (`cf push`)                          |');
    this.log('|                                                               |');
    this.log('| 🔨 Consider setting up Jenkins to continuously build your app |');
    this.log('| Use `sap-cloud-sdk add-cx-server` to create the setup script  |');
    this.log('+---------------------------------------------------------------+');
  }

  private printSuccessMessageScaffold() {
    this.log('+---------------------------------------------------------------+');
    this.log('| ✅ Init finished successfully.                                |');
    this.log('|                                                               |');
    this.log('| 🚀 Next step: Deploy your application (`npm run deploy`)      |');
    this.log('|                                                               |');
    this.log('| 🔨 Consider setting up Jenkins to continuously build your app |');
    this.log('| Use `sap-cloud-sdk add-cx-server` to create the setup script  |');
    this.log('+---------------------------------------------------------------+');
  }
}
