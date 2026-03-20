# 《交易纪律》精要

> 在系统化交易中，纪律本身就是风险控制器。

---

## 核心哲学

- 冷静执行高于临场发挥
- 连续 override 要触发 cooldown
- 风险预算只能收紧，不能在压力下放宽

---

## 对 TradeMesh 的启示

- `trade-thesis` 需要显式输出 `disciplineState`
- `policy-gate` 需要把 `cooldown/restricted` 作为硬约束
- `replay` 需要能解释纪律状态如何影响审批
