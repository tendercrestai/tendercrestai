// Native scheduled entry point; analytics-maintenance retains its protected HTTP interface.
exports.handler=()=>require('./analytics-maintenance').handler({});
