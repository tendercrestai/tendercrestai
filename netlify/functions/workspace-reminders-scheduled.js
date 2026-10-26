// Netlify's private scheduler invokes this wrapper; HTTP operator calls stay protected.
exports.handler=()=>require('./proposal-maintenance').handler({});
