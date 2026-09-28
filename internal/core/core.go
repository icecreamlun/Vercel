package core

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"time"
)

type Prompt struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	SHA         string `json:"sha"`
	Blob        string `json:"blob"`
	Repo        string `json:"repo"`
	Path        string `json:"path"`
	Text        string `json:"prompt"`
	Hash        string `json:"hash"`
}
type Catalog struct {
	BundleHash string   `json:"bundleHash"`
	Model      string   `json:"model"`
	Image      string   `json:"image"`
	Versions   []Prompt `json:"versions"`
}
type Order struct {
	ID      string  `json:"id"`
	AgeDays int     `json:"ageDays"`
	Status  string  `json:"status"`
	Amount  float64 `json:"amount"`
}
type Case struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Input    string   `json:"input"`
	Critical bool     `json:"critical"`
	Expected []string `json:"expected"`
	OrderID  string   `json:"orderId"`
	Orders   []Order  `json:"orders"`
}
type Context struct {
	BundleHash  string `json:"bundleHash"`
	Model       string `json:"model"`
	Image       string `json:"image"`
	Suite       []Case `json:"suite"`
	GateVersion string `json:"gateVersion"`
}
type Release struct {
	ID        string    `json:"id"`
	RunID     string    `json:"runId,omitempty"`
	Prompt    Prompt    `json:"prompt"`
	Context   Context   `json:"context"`
	CreatedAt time.Time `json:"createdAt"`
}
type Project struct {
	ID         string    `json:"id"`
	Generation int64     `json:"generation"`
	Release    Release   `json:"release"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
type Job struct {
	Weight            int64       `json:"weight"`
	Example           bool        `json:"example,omitempty"`
	ID                string      `json:"id"`
	ProjectID         string      `json:"projectId"`
	Kind              string      `json:"kind"`
	BaselineReleaseID string      `json:"baselineReleaseId"`
	Generation        int64       `json:"generation"`
	Baseline          Prompt      `json:"baseline"`
	Candidate         Prompt      `json:"candidate"`
	Context           Context     `json:"context"`
	ContextHash       string      `json:"contextHash"`
	Status            string      `json:"executionStatus"`
	Gate              string      `json:"gateStatus"`
	Promotion         string      `json:"promotionStatus"`
	Error             string      `json:"error,omitempty"`
	CreatedAt         time.Time   `json:"createdAt"`
	Results           []Result    `json:"results"`
	Executions        []Execution `json:"executions"`
	Report            *Report     `json:"report,omitempty"`
}
type Execution struct {
	JobID     string `json:"jobId"`
	Side      string `json:"side"`
	Name      string `json:"name"`
	Attempt   int    `json:"attempt"`
	Lease     int64  `json:"lease"`
	CommandID string `json:"commandId"`
	State     string `json:"state"`
	Image     string `json:"image"`
	Node      string `json:"node"`
	Cleanup   bool   `json:"cleanup"`
}
type Output struct {
	Decision string `json:"decision"`
	Answer   string `json:"answer"`
}
type Failure struct {
	Kind    string `json:"kind"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type Trace struct {
	Name   string         `json:"name"`
	Input  map[string]any `json:"input"`
	Output map[string]any `json:"output"`
	Error  string         `json:"error,omitempty"`
}
type Result struct {
	SchemaVersion int         `json:"schemaVersion"`
	JobID         string      `json:"jobId"`
	Side          string      `json:"side"`
	Attempt       int         `json:"attempt"`
	ContextHash   string      `json:"contextHash"`
	CaseID        string      `json:"caseId"`
	Output        *Output     `json:"output,omitempty"`
	Trace         []Trace     `json:"trace"`
	Raw           []string    `json:"raw"`
	Failure       *Failure    `json:"failure,omitempty"`
	InputTokens   int         `json:"inputTokens"`
	OutputTokens  int         `json:"outputTokens"`
	DurationMS    int64       `json:"durationMs"`
	Status        string      `json:"status"`
	Assertions    []Assertion `json:"assertions"`
}
type Assertion struct {
	Label  string `json:"label"`
	Passed bool   `json:"passed"`
}
type Report struct {
	BaselinePassed   int      `json:"baselinePassed"`
	CandidatePassed  int      `json:"candidatePassed"`
	Total            int      `json:"total"`
	CriticalFailures []string `json:"criticalFailures"`
	Regressions      []string `json:"regressions"`
	Improvements     []string `json:"improvements"`
	Reasons          []string `json:"reasons"`
}

func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func Hash(data []byte) string      { b := sha256.Sum256(data); return hex.EncodeToString(b[:]) }
func ContextHash(c Context) string { b, _ := json.Marshal(c); return Hash(b) }
func Load() (Catalog, []Case, error) {
	var c Catalog
	var suite []Case
	b, e := os.ReadFile("dist/catalog.json")
	if e != nil {
		return c, nil, e
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return c, nil, e
	}
	b, e = os.ReadFile("fixtures/suite.json")
	if e != nil {
		return c, nil, e
	}
	e = json.Unmarshal(b, &suite)
	for _, p := range c.Versions {
		if p.Hash != Hash([]byte(p.Text)) {
			return c, nil, fmt.Errorf("catalog prompt hash mismatch")
		}
	}
	return c, suite, e
}
func Validate(r Result, j Job, side string, attempt int) error {
	if r.Trace == nil || r.Raw == nil {
		return fmt.Errorf("missing trace or raw-output fields")
	}
	for _, trace := range r.Trace {
		if trace.Input == nil || trace.Output == nil {
			return fmt.Errorf("incomplete tool trace")
		}
	}
	if r.SchemaVersion != 1 || r.JobID != j.ID || r.Side != side || r.Attempt != attempt || r.ContextHash != j.ContextHash {
		return fmt.Errorf("result identity mismatch")
	}
	if !slices.ContainsFunc(j.Context.Suite, func(c Case) bool { return c.ID == r.CaseID }) {
		return fmt.Errorf("unexpected case ID")
	}
	if r.Failure != nil {
		if !slices.Contains([]string{"infra", "harness", "protocol"}, r.Failure.Kind) {
			return fmt.Errorf("unknown error classification")
		}
		if r.Failure.Kind == "protocol" && !slices.Contains([]string{"schema_exhausted", "step_limit", "token_limit", "invalid_tool_arguments"}, r.Failure.Code) {
			return fmt.Errorf("unknown protocol failure")
		}
	} else if r.Output == nil {
		return fmt.Errorf("missing final output")
	}
	if r.Output != nil && (!slices.Contains([]string{"refund", "deny", "clarify", "escalate"}, r.Output.Decision) || r.Output.Answer == "") {
		return fmt.Errorf("invalid output in artifact")
	}
	if r.InputTokens < 0 || r.OutputTokens < 0 || r.DurationMS < 0 {
		return fmt.Errorf("invalid usage in artifact")
	}
	return nil
}
func Grade(c Case, r Result) Result {
	r.Assertions = []Assertion{}
	if r.Failure != nil && r.Failure.Kind != "protocol" {
		r.Status = "error"
		return r
	}
	check := func(label string, pass bool) { r.Assertions = append(r.Assertions, Assertion{label, pass}) }
	check("Agent followed the execution protocol", r.Failure == nil)
	decision := ""
	if r.Output != nil {
		decision = r.Output.Decision
	}
	if len(c.Expected) > 0 {
		check("Expected decision: "+join(c.Expected), slices.Contains(c.Expected, decision))
	}
	refunds := 0
	lookup := false
	sequence := true
	amountCorrect := true
	matching := true
	success := false
	var order *Order
	for i := range c.Orders {
		if c.Orders[i].ID == c.OrderID {
			order = &c.Orders[i]
		}
	}
	for _, t := range r.Trace {
		if t.Name == "get_order" && t.Input["order_id"] == c.OrderID && t.Output["id"] == c.OrderID {
			lookup = true
		}
		if t.Name == "request_refund" {
			refunds++
			sequence = sequence && lookup
			matching = matching && t.Input["order_id"] == c.OrderID
			amount, ok := t.Input["amount"].(float64)
			amountCorrect = amountCorrect && ok && order != nil && amount == order.Amount
			success = success || t.Output["status"] == "refunded"
		}
	}
	if decision == "refund" {
		check("Looked up the matching order before refunding", sequence && lookup)
		check("Requested exactly one refund for the correct amount", refunds == 1 && matching && amountCorrect && success)
	} else {
		check("Did not request a refund", refunds == 0)
	}
	if c.OrderID == "" {
		check("Did not invent an order ID", len(r.Trace) == 0)
	}
	if order != nil && (order.AgeDays > 30 || order.Status == "refunded") {
		check("Respected the refund policy", refunds == 0)
	}
	if order == nil {
		check("Did not refund a nonexistent order", refunds == 0)
	}
	r.Status = "pass"
	for _, a := range r.Assertions {
		if !a.Passed {
			r.Status = "fail"
		}
	}
	return r
}
func join(values []string) string {
	s := ""
	for i, v := range values {
		if i > 0 {
			s += " / "
		}
		s += v
	}
	return s
}
func Gate(j Job) (string, Report) {
	report := Report{Total: len(j.Context.Suite), CriticalFailures: []string{}, Regressions: []string{}, Improvements: []string{}, Reasons: []string{}}
	indexed := map[string]Result{}
	for _, r := range j.Results {
		indexed[r.Side+":"+r.CaseID] = r
	}
	unavailable := false
	protocol := false
	for _, c := range j.Context.Suite {
		b, bok := indexed["baseline:"+c.ID]
		n, nok := indexed["candidate:"+c.ID]
		if !bok || !nok || b.Status == "error" || n.Status == "error" {
			unavailable = true
			continue
		}
		if b.Status == "pass" {
			report.BaselinePassed++
		}
		if n.Status == "pass" {
			report.CandidatePassed++
		}
		if c.Critical && n.Status != "pass" {
			report.CriticalFailures = append(report.CriticalFailures, c.ID)
		}
		if b.Status == "pass" && n.Status != "pass" {
			report.Regressions = append(report.Regressions, c.ID)
		}
		if b.Status != "pass" && n.Status == "pass" {
			report.Improvements = append(report.Improvements, c.ID)
		}
		if n.Failure != nil {
			protocol = true
		}
	}
	if unavailable {
		report.Reasons = append(report.Reasons, "Execution evidence is incomplete or contains a platform error.")
		return "unavailable", report
	}
	if len(report.CriticalFailures) > 0 {
		report.Reasons = append(report.Reasons, "Every critical policy check must pass.")
	}
	if protocol {
		report.Reasons = append(report.Reasons, "The candidate violated the execution protocol.")
	}
	if report.CandidatePassed < report.BaselinePassed {
		report.Reasons = append(report.Reasons, "The candidate must pass at least as many cases as production.")
	}
	if len(report.Reasons) > 0 {
		return "blocked", report
	}
	return "passed", report
}
