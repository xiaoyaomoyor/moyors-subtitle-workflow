# comlink for abstract IPC

```ts
import { expose } from 'abslink'

export default expose({
  add: (a: number, b: number) => a + b
})
```
and
```ts
import { wrap } from 'abslink'
import worker from './exposed.ts?worker'
import type Maths from './exposed.ts'

const threaded = wrap<Maths>(worker)

const res = await threaded.add(1, 3) // 4
```
