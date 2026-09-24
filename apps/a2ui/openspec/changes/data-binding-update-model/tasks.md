# Tasks

## 1. Datamodel 模块

- [x] 1.1 实现 path get/set（兼容有无 leading slash）与 applyDataModelUpdate
- [x] 1.2 实现 resolveBound / resolveRenderProps 与 path+literal 隐式初始化
- [x] 1.3 实现 updateModel 与 dispatchUserAction（含 __localUpdatePath 与 onUserAction）
- [x] 1.4 store InitOptions 增加 onUserAction；从 core 导出 datamodel API

## 2. Parser 与 treebuilder

- [x] 2.1 parser 改用 datamodel 的 applyDataModelUpdate；surfaceUpdate 调用隐式初始化
- [x] 2.2 commitTree 移到 treebuilder，供 parse 与 updateModel 共用
- [x] 2.3 assembleNode 叶子也重 render，解析 *Path，写入 surfaceId 与 v_node

## 3. React 与 playground

- [x] 3.1 表单受控：有 path 时 onChange 调用 updateModel
- [x] 3.2 Button 改走 dispatchUserAction；renderMap 传入 surfaceId 与 *Path
- [x] 3.3 增加 login-form mock；playground 展示最近一次 userAction

## 4. 测试

- [x] 4.1 path+literal 初始化、仅 path 空模型、dataModelUpdate 刷新 Text、updateModel、userAction
- [x] 4.2 更新 parser / treebuilder 回归（surfaceId、commitTree 二次 render）
- [x] 4.3 隔离 Mocha test:datamodel
