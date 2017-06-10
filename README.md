# UK Election Results Bot

This repository has the code of the bot powering the 2017 UK General Election thread's /u/VLT-bot.

The code is specific to that thread, and is unlikely to be useful as is for future threads. Nevertheless, the code is public for learning.

## How It Worked

The bot itself runs as a [webtask](https://webtask.io). It pulls its data from an [Airtable](https://airtable.com). On the night of the election, we had a human enter results as they came in to the airtable. Then, a script pinged the webtask every 5 seconds. When it ran, it checked the airtable for new results, updated the results table, and posted it to an internal Slack channel, where a human updated the sidebar. (We wanted it to update automatically, but couldn't due to a [reddit bug](https://www.reddit.com/r/bugs/comments/6dl4ep/reddit_live_some_livemanage_related_endpoints/).) Also, periodically or when overridden by a human, it posted an update to the main thread.

## Notes For Readers

Originally, we planned for the bot to also keep track of the number of popular votes per party. However, due to the way we had designed it we decided that this was too difficult. The bot still has reference to `votes` internally, however this is unused and is only kept to reduce the likelihood of bugs on the night of the thread.
