# Open Questions

The single place where Cookframe's open implementation questions are tracked. Each keeps a stable
`OQ-NN` id so a decision record can name the question it closes.

`OQ-01`–`OQ-23` originate in [`decisions-and-open-questions.md`](decisions-and-open-questions.md) §2,
which is the frozen discovery snapshot and is not updated. `OQ-24` onwards were found during
implementation.

| Id | Question | State |
|---|---|---|
| OQ-01 | exact framework/router | open |
| OQ-02 | TypeScript vs. another implementation language if real constraints justify a change | closed by ADR-0002 |
| OQ-03 | database technology | open |
| OQ-04 | JSON vs. relational physical persistence | open |
| OQ-05 | hosting platform/reference deployment | open |
| OQ-06 | object/blob storage implementation | open |
| OQ-07 | model provider | open — configuration, not a record (ADR-0004) |
| OQ-08 | model SDK/library | open — configuration, not a record (ADR-0004) |
| OQ-09 | exact provider adapter interfaces | closed by ADR-0004 |
| OQ-10 | background-job mechanism | open |
| OQ-11 | exact shortcut packaging/distribution mechanism | open |
| OQ-12 | exact mobile component/layout system | open |
| OQ-13 | eager vs. background vs. lazy Cooking Plan generation | open |
| OQ-14 | exact capture-eval thresholds | open |
| OQ-15 | exact scaling-classification algorithm | out of V1 scope |
| OQ-16 | exact safe URL-fetch implementation | open |
| OQ-17 | exact capability-token format/lifetime/revocation mechanism | open |
| OQ-18 | exact Bring integration mechanism after spike | open |
| OQ-19 | exact hero-image compression/storage variants | open |
| OQ-20 | exact unit conversion behavior | out of V1 scope |
| OQ-21 | semantic ingredient alias vocabulary | out of V1 scope |
| OQ-22 | Focus Mode | out of V1 scope |
| OQ-23 | sophisticated intermediate-food-state graph | out of V1 scope |
| OQ-24 | capture and normalization: one physical model call or two | open |

A question is closed by a decision record, by evidence from a spike, or by being ruled out of scope.
When it closes, update its state here and name what closed it.
