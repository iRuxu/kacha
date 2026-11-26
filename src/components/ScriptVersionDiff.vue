<script>
function numberedLines(source) {
  return source === '' ? [] : source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
    .map((text, index) => ({ text, number: index + 1 }))
}

function compareLines(current, historic) {
  const left = numberedLines(current)
  const right = numberedLines(historic)
  const width = right.length + 1
  const cells = (left.length + 1) * width
  const lengths = cells <= 4_000_000 ? new Uint32Array(cells) : null
  if (lengths) {
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        const k = i * width + j
        lengths[k] = left[i].text === right[j].text
          ? 1 + lengths[k + width + 1]
          : Math.max(lengths[k + width], lengths[k + 1])
      }
    }
  }

  const rows = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].text === right[j].text) {
      rows.push({ left: left[i++], right: right[j++], changed: false })
      continue
    }
    const added = []
    const removed = []
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i].text === right[j].text) break
      if (!lengths && i < left.length && j < right.length) {
        added.push(left[i++])
        removed.push(right[j++])
      } else if (j === right.length || (i < left.length && lengths[i * width + j + width] >= lengths[i * width + j + 1])) {
        added.push(left[i++])
      } else {
        removed.push(right[j++])
      }
    }
    for (let k = 0; k < Math.max(added.length, removed.length); k++) {
      rows.push({ left: added[k], right: removed[k], changed: true })
    }
  }
  return rows
}

export default {
  props: {
    current: { type: String, required: true },
    historic: { type: String, required: true },
    version: { type: String, required: true },
  },
  computed: {
    rows() {
      return compareLines(this.current, this.historic)
    },
  },
}
</script>

<template>
  <div class="diff-scroll">
    <table class="script-diff">
      <thead><tr><th scope="col">{{ $t('当前版本') }}</th><th scope="col">{{ version }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td :class="{ added: row.changed && row.left, blank: !row.left }">
            <div><span class="line-number">{{ row.left?.number }}</span><span>{{ row.changed && row.left ? '+' : '' }}</span><code>{{ row.left?.text }}</code></div>
          </td>
          <td :class="{ removed: row.changed && row.right, blank: !row.right }">
            <div><span class="line-number">{{ row.right?.number }}</span><span>{{ row.changed && row.right ? '−' : '' }}</span><code>{{ row.right?.text }}</code></div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.diff-scroll { overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
.script-diff { width: 100%; min-width: 32rem; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
th { padding: 8px 12px; text-align: start; background: var(--surface-muted, #eef1f5); }
td { padding: 0; vertical-align: top; }
td + td, th + th { border-inline-start: 1px solid var(--line); }
td div { display: grid; grid-template-columns: 4ch 1ch minmax(0, 1fr); gap: 8px; padding-inline: 8px; }
.line-number { color: var(--muted); text-align: end; font-variant-numeric: tabular-nums; user-select: none; }
code { white-space: pre-wrap; overflow-wrap: anywhere; }
.added { background: #e9f7ec; }
.removed { background: #ffeded; }
.blank { background: #f6f8fa; }
</style>
