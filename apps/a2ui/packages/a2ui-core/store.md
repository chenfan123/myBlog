interface A2UIstore {
surfaceMap:<record,Surface>,
HydrateNodeMap:<record,HyDrateNode>
}

interface Surface {
surfaceId:string,
beginrender:bool,
rootNode:HyrateNode
}

interface HyDrateNode {
componentId:string,
\_vnode:ReactElement,
ownerSurfaceId: string,
protocal:string(JSONL 协议)
}

ReactElement 其实就是{
Textfile:(props:{test})=>{

<div>{test}</div>
}
}

const ErrorType = {
PARE_ERROR
}

interface Error {
type: ErrorType,
content: string
}

store 里面还有对 surfaceMap 和 HydrateNodeMap 的增删改查操作，以及对 Error 的增删改查操作。

为了解除对 react 的依赖，store 通过 zustand/vanilla 实现状态管理
store 是一个全局单例，需要导出一个方法可以拿到 store 实例
