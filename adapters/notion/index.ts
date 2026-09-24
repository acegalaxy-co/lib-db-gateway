"use strict";
const { NotionAdapter, create } = require("./adapter");
const { createNotionClient } = require("./client");
const { createRateLimiter } = require("./rate");
const { resolveNotionConfig } = require("./config");

export = { NotionAdapter, create, createNotionClient, createRateLimiter, resolveNotionConfig };
