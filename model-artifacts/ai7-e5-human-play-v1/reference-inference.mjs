// Independent CPU reference on the public board/side tensors emitted by the encoder.
export function inferSpatial(weights, board, side, geometry, legal, slots) {
  function linear(x, prefix) {
    return weights[prefix + '.weight'].map((row, j) =>
      row.reduce((sum, w, i) => sum + w * x[i], weights[prefix + '.bias'][j]));
  }
  function conv(x, prefix, top, left, activation = Math.tanh) {
    return weights[prefix + '.weight'].map((channels, j) =>
      Array.from({length: 8}, (_, y) => Array.from({length: 4}, (_, col) => {
        let sum = weights[prefix + '.bias'][j];
        channels.forEach((kernel, c) => kernel.forEach((row, dy) => row.forEach((w, dx) =>
          sum += w * (x[c][y + dy - top]?.[col + dx - left] ?? 0))));
        return activation(sum);
      })));
  }
  const first = conv(board, 'board.0', 0, 0);
  const identity = x => x;
  const branches = [0,1,2].flatMap((i) => {
    const key = 'board.2.branches.'+i;
    return weights[key+'.weight'] ? conv(first,key,[1,0,7][i],[1,3,0][i],identity) : [];
  });
  const map = branches.length ? conv(branches,'board.2.fusion',0,0) :
    weights['board.3.weight'] ? conv(first,'board.3',weights['board.3.weight'][0][0].length/2-1,1) :
    conv(first,'board.2',1,1);
  const mean = map.map(channel => channel.flat().reduce((a,b) => a+b, 0)/32);
  const flat = Array.from({length:32}, (_,i)=>map.map(c=>c[Math.floor(i/4)][i%4])).flat();
  const h = linear([...side, ...(weights['context.0.weight'][0].length===979 ? flat : mean)], 'context.0').map(Math.tanh);
  const cell = square => map.map(channel => channel[Math.floor(square / 4)][square % 4]);
  const logits = legal.map(id => {
    const name = id < 32 ? 'flip' : 'move';
    const src = id < 32 ? [] : cell(Math.floor((id-32)/32));
    const inputs = [...h, ...src, ...cell(id % 32), ...geometry[id]];
    const hidden = linear(inputs,name+'.0');
    if (id>=32 && slots.length) {
      const ray = slots[id%32].flatMap(i=>i===32 ? Array(12).fill(0) : cell(i));
      weights['ray.weight'].forEach((r,i) => hidden[i] += r.reduce((a,v,j)=>a+v*ray[j],0));
    }
    return linear(hidden.map(Math.tanh),name+'.2')[0];
  });
  const exp = logits.map(z => Math.exp(z - Math.max(...logits)));
  const sum = exp.reduce((a,b) => a+b,0);
  const critic = linear(h,'critic');
  const wdl = critic.map(v=>Math.exp(v-Math.max(...critic)));
  const value = critic.length===3 ? (wdl[0]-wdl[2])/wdl.reduce((a,b)=>a+b,0) : critic[0];
  return {prob:exp.map(v => v/sum), value};
}
