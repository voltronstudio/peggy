#!/usr/bin/env node
import { program } from 'commander';
import pkg from '../package.json';
import { BumpCommand } from './commands/BumpCommand';
import { StatusCommand } from './commands/StatusCommand';
import { ValidateCommand } from './commands/ValidateCommand';

program.version(`Peggy v${pkg.version}`);

program
  .command('status [app]')
  .option('-c --config <path>', 'set the config', '.peggy')
  .option('-e --env <environment>', 'override the default environment in the config')
  .option('--debug', 'displays stacktrace when errors occur', false)
  .description('display the status of all apps in your cluster')
  .action(StatusCommand);

program
  .command('bump <app> [repository]')
  .option('-c --config <path>', 'set the config', '.peggy')
  .option('-e --env <environment>', 'override the default environment in the config')
  .option('-n --max-results <n>', 'maximum number of images to retrieve', '20')
  .option('--push', 'pushes the generated commit the configured remote')
  .option('--debug', 'displays stacktrace when errors occur', false)
  .description('bumps an image in your repository to a container in your app')
  .alias('b')
  .action(BumpCommand);

program
  .command('validate <path>')
  .option('--debug', 'displays stacktrace when errors occur', false)
  .description('validates your variables.json file specified by the path')
  .action(ValidateCommand);

program.parse(process.argv);
