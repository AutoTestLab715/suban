const safeDecode = (value) => {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
};

module.exports = {
  safeDecode,
};
