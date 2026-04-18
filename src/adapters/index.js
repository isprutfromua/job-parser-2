const robota = require("./robota");
const work = require("./work");
const djinni = require("./djinni");
const douFamily = require("./douFamily");

const ADAPTERS = {
  robota,
  work,
  djinni,
  dou_family: douFamily,
};

module.exports = {
  ADAPTERS,
};
