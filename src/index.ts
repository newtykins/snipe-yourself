#!/usr/bin/env node
import { v2 as osu } from 'osu-api-extended';
import inquirer from 'inquirer';
import ConfigStore from 'configstore';
import Listr from 'listr';
import {
    beatmaps_short_2_object as Beatmap,
    user_data as User,
    user_scores_object as Score
} from 'osu-api-extended/dist/types/v2';
import Bluebird from 'bluebird';
import { Table } from 'console-table-printer';
import { rankColours } from './constants';
import chalk from 'chalk';
import url from 'terminal-link';

// todo: add subcommands and rewrite module as cli
// todo: cache map data for rebases
// todo: file output
// todo: allow for the user and mode to be configurable - atm id is hardcoded to newt

// Read the config store
const config = new ConfigStore('snipe-yourself', null, { globalConfigPath: true });

let clientId: number = config.get('clientId');
let clientSecret: string = config.get('clientSecret');

const rebase = async (score: Score, user: User, beatmap: Beatmap): Promise<number> => {
    const { max_combo: maxCombo } = beatmap;
    const {
        max_combo: scoreCombo,
        statistics: {
            count_50: count50,
            count_100: count100,
            count_300: count300,
            count_miss: misscount
        }
    } = score;

    const comboPercentage = scoreCombo / maxCombo;
    const badAccuracy = misscount + count50 * 8 + count100 * 2 * (count300 / maxCombo);
    const accDiff = Math.floor(user['statistics'].hit_accuracy) - score.accuracy * 100;

    return (accDiff * 1.2 * comboPercentage) / badAccuracy;
};

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
                user = await osu.user.get(16009610, 'osu');
            }
        },
        {
            title: "Fetch the user's top plays and rebase them",
            task: async () => {
                const bestScores = await osu.scores.users.best(user.id, {
                    mode: 'osu',
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
        .then(() => {
            // Output as tables to the console
            const ranks = scores.map(score => score.rank).filter((v, i, s) => s.indexOf(v) === i);

            ranks.forEach(rank => {
                const scoresOfRank = scores
                    .filter(s => s.rank === rank)
                    .sort((a, b) => b.rebase - a.rebase);
                const table = new Table();

                console.log(chalk.bold(rankColours[rank.toUpperCase()](rank.substring(0))));

                scoresOfRank.forEach(score =>
                    table.addRow({
                        'Beatmap Name': url(score.name, score.beatmapUrl),
                        Difficulty: score.difficulty,
                        'Rebase Value': score.rebase.toFixed(5),
                        Combo: `${score.combo}/${score.maxCombo}`,
                        Accuracy: `${score.accuracy.toFixed(2)}%`
                    })
                );

                table.printTable();
            });
        });
});

namespace SnipeYourself {
    export interface Score {
        rebase: number;
        beatmapUrl: string;
        name: string;
        difficulty: string;
        accuracy: number;
        rank: string;
        maxCombo: number;
        combo: number;
    }
}
