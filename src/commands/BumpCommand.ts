import { Command } from 'commander';
import Joi from 'joi';
import { ECR, SharedIniFileCredentials } from 'aws-sdk';
import consola from 'consola';
import { find, includes, some, isEmpty } from 'lodash';
import { NumberPrompt, Select } from 'enquirer';
import Table from 'cli-table3';
import colors from 'colors';
import { persistVariables } from '../services/VariablesParser';
import { AwsEcrRegistryService } from '../services/AwsEcrRegistryService';
import { Repository } from '../typed/core/Repository';
import { Image } from '../typed/core/Image';
import { InputError } from '../core/Errors';
import { Container, isContainer } from '../typed/Variables';
import { getHumanFileSize, getAppRepository, getContext, getHumanFriendlyDateTime } from '../core/Utils';

interface Options {
  app: string;
  repository: string;
  config: string;
  environment?: string;
  push: boolean;
  maxResults: number;
}

const Options = {
  schema: Joi.object({
    app: Joi.string().required(),
    repository: Joi.string().required(),
    config: Joi.string().required(),
    environment: Joi.string(),
    push: Joi.boolean().required(),
    maxResults: Joi.number().min(1).max(1000).required(),
  }),
};

const promptImageSelection = async (
  repository: Repository,
  images: Image[],
  existingImages: string[],
): Promise<{ image: Image; tag: string }> => {
  const table = new Table({
    chars: { mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
    head: ['Idx', 'Tag', 'Pushed at', 'Size'],
    style: { border: ['white'] },
  });
  const tagIndexMap = {} as Record<number, string>;

  images.forEach((image, imageIndex) =>
    (image.tags ?? []).forEach((t, tagIndex) => {
      const index = imageIndex + tagIndex;
      const isTagPreExisting = some(existingImages.map(i => i.endsWith(t)));
      const tag = isTagPreExisting ? `${t} ${colors.green('(*)')}` : t;
      tagIndexMap[index] = t;
      table.push([index, tag, getHumanFriendlyDateTime(image.pushedAt), getHumanFileSize(image.sizeInBytes)]);
    }),
  );
  consola.log(table.toString());

  const prompt = new NumberPrompt({
    name: 'number',
    message: `Select the "Idx" you want to deploy (${repository.name})`,
  });

  try {
    const index = (await prompt.run()) as number;
    if (index < 0 || index >= table.length) {
      throw new InputError(`The "Idx" you specified was invalid. Choose between "0-${table.length - 1}": ${index}`);
    }

    const tag = tagIndexMap[index];
    return { tag, image: find(images, ({ tags }) => includes(tags, tag)) as Image };
  } catch (err) {
    throw err instanceof InputError ? new InputError(err.message) : err;
  }
};

const promptContainerSelection = async (appName: string, containers: Record<string, Container>): Promise<Container> => {
  const prompt = new Select({
    name: 'container',
    message: `Found ${Object.keys(containers).length} containers in specified app: "${appName}". Choose one`,
    choices: Object.keys(containers),
  });
  return containers[await prompt.run()];
};

export const BumpCommand = async (
  appName: string,
  repositoryName: string | undefined,
  command: Command,
): Promise<void> => {
  try {
    const options: Options = Options.schema.validate({
      app: appName,
      repository: repositoryName ?? appName,
      config: command.config,
      environment: command.env,
      push: command.push ?? false,
      maxResults: command.maxResults,
    }).value;
    const { config, variables, variablesPath } = await getContext(options.config, options.environment);

    const awsCredentials = new SharedIniFileCredentials({ profile: config.defaultAwsProfile });
    const awsEcrClient = new ECR({ credentials: awsCredentials, region: config.defaultAwsRegion });
    const awsEcrRegistry = new AwsEcrRegistryService(awsEcrClient);

    if (!variables.apps[options.app]) {
      throw new InputError(`The specified service does not exist: "${options.app}"`);
    }

    const repositories = await awsEcrRegistry.getRepositories();
    if (!isEmpty(repositories)) {
      consola.success(`Found the following repositories! ${repositories.map(r => r.name).join(', ')}`);
    }

    const repository = getAppRepository(options.repository, repositories);
    if (!repository) {
      throw new InputError(`"${options.repository}" does not exist in your registry...`);
    }

    consola.success(`Found your repository: "${options.repository}"! Fetching images and tags...`);
    const images = await awsEcrRegistry.getImagesByRepository(repository, options.maxResults);

    if (images.length === 0) {
      consola.info(`There were no images found for repository: "${repository.name}"`);
    } else {
      consola.info(`Found ${images.length} image(s) for "${repository.uri}"`);
      const { containers } = variables.apps[options.app];
      const existingImages = isContainer(containers) ? [containers.image] : Object.values(containers).map(c => c.image);
      const { tag } = await promptImageSelection(repository, images, existingImages);
      const fqin = `${repository.uri}:${tag}`;
      const container = isContainer(containers) ? containers : await promptContainerSelection(options.app, containers);

      consola.info(`Previous image: ${container.image}`);
      container.image = fqin;
      await persistVariables(variablesPath, variables);

      consola.success(`Updated "${options.app}"! ${fqin}`);
    }
  } catch (err) {
    if (command.debug && err.stack) {
      consola.error(err.stack);
    } else if (err.message) {
      consola.error(err.message);
    }
  }
};
