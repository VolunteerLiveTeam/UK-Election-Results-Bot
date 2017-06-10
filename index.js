const Airtable = require('airtable');
const snoowrap = require('snoowrap');
const moment = require('moment');
const request = require('request');

const decimalify = num => num > 10 ? num.toFixed(0) : num.toFixed(2);

function formatArray(arr){
    var outStr = "";
    if (arr.length === 1) {
        outStr = arr[0];
    } else if (arr.length === 2) {
        //joins all with "and" but no commas
        //example: "bob and sam"
        outStr = arr.join(' and ');
    } else if (arr.length > 2) {
        //joins all with commas, but last one gets ", and" (oxford comma!)
        //example: "bob, joe, and sam"
        outStr = arr.slice(0, -1).join(', ') + ', and ' + arr.slice(-1);
    }
    return outStr;
}

function embolden(arr) {
    return arr.map(str => '**' + str + '**');
}

const TEMPLATES = {
    hold: (party, holdConsti, partySeats) => `${party} hold ${formatArray(embolden(holdConsti))}, giving them a total of ${partySeats} seats, or ${decimalify((partySeats / 650.0) * 100)}% of Parliament.`,
    gain: (wonParty, gainString, partySeats) => `${wonParty} gain ${gainString}, giving them a total of ${partySeats} seats, or ${decimalify((partySeats / 650.0) * 100)}% of Parliament.`,
    holdGain: (wonParty, holdConsti, gainString,  partySeats) => `${wonParty} hold ${formatArray(embolden(holdConsti))} and gain ${gainString}, giving them a total of ${partySeats} seats, or ${decimalify((partySeats / 650.0) * 100)}% of Parliament.`,
    gainString: (place, lostParty) => `**${place}** from ${lostParty}`,
    table: function(data, reported) {
        const { 
            Conservatives: con,
            Labour: lab,
            SNP: snp,
            ['Liberal Democrats']: libdem,
            UKIP: ukip,
            ['Plaid Cymru']: pc,
            ['Sinn Féin']: sf,
            DUP: dup,
            UUP: uup,
            SDLP: sdlp,
            Green: green,
            Independent: ind
            } = data;
        return `
Party | Seats | %
:---------|:--------:|:--------:
Conservative | ${con.seats} | ${((con.seats / 650) * 100).toFixed(2)}%
Labour | ${lab.seats} | ${((lab.seats / 650) * 100).toFixed(2)}%
SNP | ${snp.seats} | ${((snp.seats / 650) * 100).toFixed(2)}%
Liberal Democrats | ${libdem.seats} | ${((libdem.seats / 650) * 100).toFixed(2)}%
UKIP | ${ukip.seats} | ${((ukip.seats / 650) * 100).toFixed(2)}%
Plaid Cymru | ${pc.seats} | ${((pc.seats / 650) * 100).toFixed(2)}%
Sinn Féin | ${sf.seats} | ${((sf.seats / 650) * 100).toFixed(2)}%
DUP | ${dup.seats} | ${((dup.seats / 650) * 100).toFixed(2)}%
UUP | ${uup.seats} | ${((uup.seats / 650) * 100).toFixed(2)}%
SDLP | ${sdlp.seats} | ${((sdlp.seats / 650) * 100).toFixed(2)}%
Green | ${green.seats} | ${((green.seats / 650) * 100).toFixed(2)}%
Independent | ${ind.seats} | ${((ind.seats / 650) * 100).toFixed(2)}%

**Percentage Reporting: ${((reported / 650) * 100).toFixed(2)}%**

`;
    },
};

function postThread(from, lastTime, base, r, partyTotals, cb) {
    base('2017 Data').select({
            maxRecords: 100,
            pageSize: 100,
            filterByFormula: '{ID} > ' + from,
            sort: [{field: "ID", direction: "asc"}],
    }).firstPage((err, page) => {
        if (err) {
            cb(err);
        }
        const data = page.map(record => ({ 
            id: record.get('ID'),
            consti: record.get('Constituency Name')[0],
            party: record.get('Party Name')[0],
            party2015: record.get('2015 Winner')[0],
            votes: record.get('Votes'),
            override: record.get('Override'),
        }));
        // Dedupe entries
        // You could probably do this with a oneliner, with three levels of map and reduce, but no.
        const result = {};
        data.forEach(item => {
            if (!result[item.party]) {
                result[item.party] = {hold: [], gain: []};
            }
            if (item.party === item.party2015) {
                result[item.party].hold.push(item);
            } else {
                result[item.party].gain.push(item);
            }
        });

        const outputs = Object.keys(result).map(party => {
            const item = result[party];
            const total = partyTotals[party];
            const holds = item.hold.map(thing => thing.consti);
            if (item.gain.length === 0) {
                return TEMPLATES.hold(party, holds, total);
            }
            const gainString = formatArray(item.gain.map(gain => TEMPLATES.gainString(gain.consti, gain.party2015)));
            if (item.hold.length === 0) {
                return TEMPLATES.gain(party, gainString, total)
            } else {
                return TEMPLATES.holdGain(party, holds, gainString, total);
            }
        });

        // Post to reddit!
        const thread = r.getLivethread('z1nrurchsalg');
        thread.addUpdate(
            `**Election Results Update**\n\nChanges since the last automated update *(${moment.unix(lastTime).fromNow()})*:\n\n` +
            outputs.join('\n\n')
        );
    });
}

module.exports = (ctx, cb) => {
    const r = new snoowrap({
        userAgent: ctx.secrets.REDDIT_USER_AGENT,
        clientId: ctx.secrets.REDDIT_ID,
        clientSecret: ctx.secrets.REDDIT_SECRET,
        username: ctx.secrets.REDDIT_USERNAME,
        password: ctx.secrets.REDDIT_PASSWORD
    });
    const base = new Airtable({ apiKey: ctx.secrets.AIRTABLE_KEY }).base('app9qoCA3efUinB0S');
    ctx.storage.get((error, storageData) => {
        if (error) {
            return cb(error);
        }
        storageData = storageData || { seatsSinceLastUpdate: 999999, lastPostId: 0, lastCheckedId: 0, lastUpdateTime: moment().unix() };
        if (!storageData.lastUpdateTime) {
            storageData.lastUpdateTime = moment().unix();
        }
        // First, find all new entries since the last time we checked
        base('2017 Data').select({
            maxRecords: 100,
            pageSize: 100,
            filterByFormula: '{ID} > ' + storageData.lastCheckedId,
            sort: [{field: "ID", direction: "asc"}],
        }).firstPage((err, page) => {
            if (page.length === 0) {
                cb(null, "Nothing to do.");
            }
            const data = page.map(record => ({ 
                id: record.get('ID'),
                consti: record.get('Constituency Name')[0],
                party: record.get('Party Name')[0],
                party2015: record.get('2015 Winner')[0],
                votes: record.get('Votes'),
                override: record.get('Override'),
            }));

            // Find the party totals
            base('Parties').select({
                maxRecords: 100,
                pageSize: 100,
                fields: ['Name', 'Count', 'Sum of Votes']
            }).firstPage((err2, partyPage) => {
                // Convert the array into an object {Conservatives: 123, ...}
                const partySeats = partyPage.reduce(
                    (prev, record) => Object.assign(prev, {[record.get('Name')]: record.get('Count')})
                , {});
                const partyVotes = partyPage.reduce(
                    (prev, record) => Object.assign(prev, {[record.get('Name')]: record.get('Sum of Votes')})
                , {});
                const totalSeats = Object.keys(partySeats)
                                    .map(key => partySeats[key])
                                    .reduce((total, seats) => total + seats, 0);
                
                if (storageData.seatsSinceLastUpdate + page.length >= 20 || data[page.length - 1].override) {
                    postThread(storageData.lastPostId, storageData.lastUpdateTime, base, r, partySeats, err => {
                        if (err) {
                            cb(err);
                        }
                    });
                    storageData.seatsSinceLastUpdate = 0;
                    storageData.lastUpdateTime = moment().unix();
                    storageData.lastPostId = data[page.length - 1].id;
                }
                

                const tableData = Object.keys(partyVotes).reduce((obj, party) => {
                    const result = {};
                    result.seats = partySeats[party];
                    result.votes = partyVotes[party];
                    return Object.assign(obj, { [party]: result });
                }, {});

                const table = TEMPLATES.table(tableData, totalSeats);

                r.getLivethread('z1nrurchsalg').fetch().then(thread => {
                    const oldResources = thread.resources;
                    const resources = oldResources.replace(/(######\*\*326 Seats Needed for Majority\*\*\n\n)([\s\S]+)(?=\*\*Turnout)/, '$1'+table);
                    request({
                        method: 'POST',
                        uri: ctx.secrets.SLACK_URL,
                        json: true,
                        body: {
                            text: '```\n' + resources + '\n```',
                        }
                    }, (reqErr) => {
                        if (reqErr) {
                            cb(reqErr);
                        }
                        storageData.lastCheckedId = data[page.length - 1].id;
                        ctx.storage.set(storageData, err => {
                            if (err) {
                                cb(err);
                            } else {
                                cb(null, {error: false, lastPostId: storageData.lastPostId, data});
                            }
                        })
                    });
                }, err => {
                    cb(err);
                });
                
            });
        });
    });
};
