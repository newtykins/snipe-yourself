#!/usr/bin/env node
import { v2 as osu } from 'osu-api-extended';
import inquirer from 'inquirer';
import Conf from 'conf';
import Listr from 'listr';
import { user_data as User } from 'osu-api-extended/dist/types/v2';
import Bluebird from 'bluebird';
import { rankColours, rebase, SnipeYourself, logError, validModes } from './utils.js';
import chalk from 'chalk';
import { Command as Commander } from 'commander';
import fs from 'fs';
import path from 'path';

// todo: cache map data for rebases

const { version } = JSON.parse(
    fs.readFileSync(path.join(path.resolve(), 'package.json')).toString()
);
const program = new Commander().version(version);

program
    .command('profile')
    .argument('<id>', "The profile's ID")
    .argument('[mode]', 'The chosen osu gamemode', 'osu')
    .option('-c, --console', 'Displays the output in the console')
    .option('-j, --json <path>', 'Outputs all of the results as JSON')
    .description("rate a profile's chokes from its ID")
    .action(async (id: string, mode: string, options) => {
        // Default to output to the console
        if (!options.console && !options.json) options.console = true;

        if (options.json) {
            const { default: isValidPath } = await import('is-valid-path');

            // todo: maybe create folders if they do not exist?
            if (!isValidPath(options.json) || !fs.existsSync(options.json)) {
                return logError(
                    `"${options.json}" is not a valid path! Please ensure that it exists, and that you have inputted it correctly!`
                );
            }
        }

        // Ensure that the inputted user ID is numeric
        const userId = parseInt(id);

        if (isNaN(userId)) {
            return logError(
                `"${userId}" is not a valid number, and therefore can not be a user ID!`
            );
        }

        // Parse the mode argument
        const parsedMode = validModes.includes(mode.toLowerCase()) ? mode.toLowerCase() : null;

        if (!parsedMode) {
            return logError(
                `"${mode}" is not a valid gamemode! Please choose one of the following:\n${validModes
                    .map(m => `• ${m}`)
                    .join('\n')}`
            );
        }

        // Read the config store
        const config = new Conf<SnipeYourself.Config>();
        let clientId = config.get('clientId');
        let clientSecret = config.get('clientSecret');

        new Promise(async resolve => {
            var questions: inquirer.InputQuestion<any>[] = [];

            if (!clientId) {
                questions.push({
                    name: 'clientId',
                    type: 'input',
                    message: 'Enter your osu! client ID:',
                    validate: value => (isNaN(value) ? 'Your client ID must be a number!' : true)
                });
            }

            if (!clientSecret) {
                questions.push({
                    name: 'clientSecret',
                    type: 'input',
                    message: 'Enter your osu! client secret:'
                });
            }

            // Fire the inquirer
            if (questions.length > 0) {
                const results = await inquirer.prompt(questions);

                if (results['clientId']) {
                    clientId = results['clientId'];
                    config.set('clientId', clientId);
                }

                if (results['clientSecret']) {
                    clientSecret = results['clientSecret'];
                    config.set('clientSecret', clientSecret);
                }
            }

            resolve(null);
        }).then(() => {
            let user: User;
            let scores: SnipeYourself.Score[] = [];

            new Listr([
                {
                    title: 'Log into the osu! API',
                    task: async () => await osu.login(clientId, clientSecret)
                },
                {
                    title: 'Find the user on osu!',
                    task: async () => {
                        user = await osu.user.get(userId, parsedMode as any);
                        // @ts-ignore
                        if (user.hasOwnProperty('error')) {
                            throw new Error(
                                `A valid user does not exist on osu! with the ID ${userId}`
                            );
                        }
                    }
                },
                {
                    title: "Fetch the user's top plays and rebase them",
                    task: async () => {
                        const bestScores = await osu.scores.users.best(user.id, {
                            mode: parsedMode as any,
                            limit: 100
                        });

                        scores = await Bluebird.map(
                            bestScores,
                            async (score): Promise<SnipeYourself.Score> => {
                                const beatmap = await osu.beatmap.get(score.beatmap.id);

                                return {
                                    rebase: await rebase(score, user, beatmap),
                                    beatmapUrl: `https://osu.ppy.sh/b/${score.beatmap.id}`,
                                    name: score.beatmapset.title_unicode,
                                    difficulty: score.beatmap.version,
                                    accuracy: score.accuracy * 100,
                                    rank: score.rank,
                                    maxCombo: beatmap.max_combo,
                                    combo: score.max_combo
                                };
                            }
                        );
                    }
                },
                {
                    title: 'Sort the scores by rebase',
                    task: () => {
                        console.log(scores.filter(s => s.accuracy === 100).length);
                        scores = scores
                            .sort((a, b) => b.rebase - a.rebase)
                            .filter(s => s.accuracy !== 100)
                            .filter(s => s.rebase > 0);
                    }
                }
            ])
                .run()
                .then(async () => {
                    const ranks = scores
                        .map(score => score.rank)
                        .filter((v, i, s) => s.indexOf(v) === i);

                    if (options.console) {
                        // Load dynamic modules
                        const { default: link } = await import('terminal-link');
                        const { Table } = await import('console-table-printer');

                        const sendTable = (rank: string) => {
                            const scoresOfRank = scores
                                .filter(s => s.rank === rank)
                                .sort((a, b) => b.rebase - a.rebase);
                            const table = new Table();

                            console.log(
                                chalk.bold(rankColours[rank.toUpperCase()](rank.substring(0)))
                            );

                            scoresOfRank.forEach(score =>
                                table.addRow({
                                    'Beatmap Name': link(score.name, score.beatmapUrl),
                                    Difficulty: score.difficulty,
                                    'Rebase Value': score.rebase.toFixed(5),
                                    Combo: `${score.combo}/${score.maxCombo}`,
                                    Accuracy: `${score.accuracy.toFixed(2)}%`
                                })
                            );

                            table.printTable();
                        };

                        if (ranks.includes('SH')) sendTable('SH');
                        if (ranks.includes('S')) sendTable('S');
                        if (ranks.includes('A')) sendTable('A');
                        if (ranks.includes('B')) sendTable('B');
                        if (ranks.includes('C')) sendTable('C');
                        if (ranks.includes('D')) sendTable('D');
                    }

                    if (options.json) {
                        ranks.forEach(rank => {
                            const scoresOfRank = scores
                                .filter(s => s.rank === rank)
                                .sort((a, b) => b.rebase - a.rebase);

                            fs.writeFileSync(
                                path.join(options.json, `${rank.toUpperCase()}.json`),
                                JSON.stringify(scoresOfRank, null, 4)
                            );
                        });
                    }
                });
        });
    });

program.parse();
