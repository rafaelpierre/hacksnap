const React = require("react");

function MockImage({
  src,
  alt,
  width,
  height,
  loading,
  decoding,
  sizes,
  fetchPriority,
  onError,
  ref,
}) {
  return React.createElement("img", {
    src,
    alt,
    width,
    height,
    loading,
    decoding,
    sizes,
    fetchPriority,
    onError,
    ref,
  });
}

module.exports = MockImage;
