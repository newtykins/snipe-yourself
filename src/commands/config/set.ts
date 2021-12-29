import { Command } from '@oclif/core';
import { ArgInput } from '@oclif/core/lib/interfaces';
import Conf from 'conf';
import * as stringSimilarity from 'string-similarity';
import { Config, schema } from '../../constants';
import Logger from '../../Logger';
import { formatSetting, generateList } from '../../utils';

export default class Set extends Command {
    static description: string = 'update a setting with a new value!';
    static aliases: string[] = ['config update'];

    static args: ArgInput = [
        { name: 'setting', description: 'setting to update', required: true },
        { name: 'value', description: 'value to update the setting to', required: true }
    ];

    static examples: string[] = [
        '$ snipe config set client_id 11655',
        '$ snipe config set secret your-epic-secret',
        '$ snipe config set profile 16009610'
    ];

    async run() {
        const config = new Conf<Config>({ schema });
        const { args } = await this.parse(Set);

        // Find the closest key in the config
        const { target: setting, rating } = stringSimilarity.findBestMatch(
            args.setting,
            Object.keys(schema)
        ).bestMatch;

        // Ensure that it is a good match
        if (rating < config.get('autocorrect_confidence')) {
            return Logger.warn(
                `I'm not quite sure what you meant by "${
                    args.setting
                }", please make sure you choose an option from the list below: ${generateList(
                    Object.keys(schema).map(k => formatSetting(k))
                )}`
            );
        }

        // Update the config
        const { value } = args;
        const { type } = schema[setting];

        try {
            config.set(setting, type.includes('number') ? parseInt(value) : value);

            Logger.success(
                `Successfully updated ${formatSetting(setting)} to ${
                    type.includes('number') ? value : `${value}`
                }`
            );
        } catch (error) {
            Logger.error(
                `The value for ${formatSetting(
                    setting
                )} must be a ${type[0].toLowerCase()}! Please try again!`
            );
        }
    }
}
