const { registerOpenDetailsCommand } = require('./commands/openDetails');
const { registerRefreshAndParseCommands } = require('./commands/refreshParse');
const { registerCheckAndRankCommands } = require('./commands/searchRank');
const { registerAnnotateCommand } = require('./commands/annotate');

function registerCoreCommands(deps) {
    return [
        ...registerOpenDetailsCommand(deps),
        ...registerRefreshAndParseCommands(deps),
        ...registerCheckAndRankCommands(deps),
        ...registerAnnotateCommand(deps)
    ];
}

module.exports = {
    registerCoreCommands
};
