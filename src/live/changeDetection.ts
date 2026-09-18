export function pixelDiffRatio(a: ImageData, b: ImageData): number {
  let acc = 0
  const n = a.data.length
  for (let i = 0; i < n; i += 4) {
    acc +=
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2])
  }
  return acc / ((n / 4) * 3 * 255)
}

export const LIVE_CHANGE_THRESHOLD = 0.035
