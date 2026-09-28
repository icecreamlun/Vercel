package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWritesRequireOriginAndCustomHeader(t *testing.T) {
	app := (&Server{Origin: "https://promptship.example"}).Handler()
	for _, tc := range []struct{ origin, header, contentType string }{{"", "1", "application/json"}, {"https://attacker.example", "1", "application/json"}, {"https://promptship.example", "", "application/json"}, {"https://promptship.example", "1", "text/plain"}} {
		request := httptest.NewRequest("POST", "/api/demo/session", strings.NewReader("{}"))
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("X-PromptShip-Request", tc.header)
		request.Header.Set("Content-Type", tc.contentType)
		response := httptest.NewRecorder()
		app.ServeHTTP(response, request)
		if response.Code != 403 {
			t.Fatalf("cross-origin request accepted: %d", response.Code)
		}
	}
}
