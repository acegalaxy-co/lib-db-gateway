"use strict";
const { createCallerValidator } = require("@acegalaxy/lib-security-utils/caller-validator");
const validator = createCallerValidator({ extraFields: [] });
module.exports = { resolveCaller: validator.resolveCaller };
