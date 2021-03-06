import { promisify } from 'util';
import { readFile } from 'fs';
import { Config } from '../typed/Config';
import { encodeAFromJson } from '../vendor/Joi';

export const loadAndParseConfig = async (path: string): Promise<Config> => {
  const data = await promisify(readFile)(path, { encoding: 'utf-8' });
  const json = JSON.parse(data);
  return encodeAFromJson<Config>(json, Config.schema);
};
