package core

import "testing"

func TestGateBlocksCriticalDespiteOverallImprovement(t *testing.T) {
	j := Job{Context: Context{Suite: []Case{{ID: "a"}, {ID: "b"}, {ID: "policy", Critical: true}}}, Results: []Result{{Side: "baseline", CaseID: "a", Status: "fail"}, {Side: "candidate", CaseID: "a", Status: "pass"}, {Side: "baseline", CaseID: "b", Status: "fail"}, {Side: "candidate", CaseID: "b", Status: "pass"}, {Side: "baseline", CaseID: "policy", Status: "pass"}, {Side: "candidate", CaseID: "policy", Status: "fail"}}}
	gate, r := Gate(j)
	if gate != "blocked" || r.CandidatePassed <= r.BaselinePassed {
		t.Fatal(gate, r)
	}
	j.Results = j.Results[:5]
	gate, _ = Gate(j)
	if gate != "unavailable" {
		t.Fatal("missing result must not disappear from denominator")
	}
}
func TestGradeUsesActualToolEvidence(t *testing.T) {
	c := Case{OrderID: "old", Orders: []Order{{ID: "old", AgeDays: 45, Status: "paid", Amount: 79}}, Expected: []string{"deny"}}
	r := Result{Output: &Output{Decision: "deny", Answer: "I did not refund."}, Trace: []Trace{{Name: "request_refund", Input: map[string]any{"order_id": "old", "amount": float64(79)}}}}
	if Grade(c, r).Status != "fail" {
		t.Fatal("self-report cannot override trace")
	}
}
func TestPlatformErrorsAreNotPromptFailures(t *testing.T) {
	r := Grade(Case{}, Result{Failure: &Failure{Kind: "harness"}})
	if r.Status != "error" {
		t.Fatal(r)
	}
}

func TestGateDistinguishesProtocolAndInfrastructure(t *testing.T) {
	j := Job{Context: Context{Suite: []Case{{ID: "one"}}}, Results: []Result{{Side: "baseline", CaseID: "one", Status: "fail", Failure: &Failure{Kind: "protocol", Code: "schema_exhausted"}}, {Side: "candidate", CaseID: "one", Status: "pass"}}}
	if gate, _ := Gate(j); gate != "passed" {
		t.Fatal("a candidate may fix baseline protocol failures", gate)
	}
	j.Results[1].Status = "fail"
	j.Results[1].Failure = &Failure{Kind: "protocol", Code: "step_limit"}
	if gate, _ := Gate(j); gate != "blocked" {
		t.Fatal("candidate protocol failure was allowed", gate)
	}
	j.Results[0].Status = "error"
	j.Results[0].Failure = &Failure{Kind: "infra"}
	if gate, _ := Gate(j); gate != "unavailable" {
		t.Fatal("infrastructure failure scored as prompt behavior", gate)
	}
}
func TestValidateRejectsMissingOrForeignEvidence(t *testing.T) {
	j := Job{ID: "job", ContextHash: "context", Context: Context{Suite: []Case{{ID: "case"}}}}
	r := Result{SchemaVersion: 1, JobID: j.ID, Side: "baseline", Attempt: 1, ContextHash: j.ContextHash, CaseID: "case", Output: &Output{Decision: "deny", Answer: "No."}, Raw: []string{}, Trace: []Trace{}}
	if err := Validate(r, j, "baseline", 1); err != nil {
		t.Fatal(err)
	}
	r.Trace = nil
	if Validate(r, j, "baseline", 1) == nil {
		t.Fatal("missing tool evidence accepted")
	}
	r.Trace = []Trace{}
	r.JobID = "another-job"
	if Validate(r, j, "baseline", 1) == nil {
		t.Fatal("foreign result accepted")
	}
}
