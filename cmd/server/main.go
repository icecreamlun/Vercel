package main

import (
	"context"
	"crypto/tls"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.temporal.io/sdk/client"
	tw "go.temporal.io/sdk/worker"

	"promptship/internal/core"
	"promptship/internal/server"
	"promptship/internal/store"
	pw "promptship/internal/worker"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	if e := run(); e != nil {
		slog.Error("server stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if e := core.ArchiveBundles(); e != nil {
		return e
	}
	catalog, suite, e := core.Load()
	if e != nil {
		return e
	}
	db, e := store.Open(ctx, env("DATABASE_URL", "postgres://localhost:54329/promptship?sslmode=disable"), catalog, suite)
	if e != nil {
		return e
	}
	defer db.Pool.Close()
	options := client.Options{HostPort: env("TEMPORAL_ADDRESS", "localhost:7233"), Namespace: env("TEMPORAL_NAMESPACE", "default")}
	if key := os.Getenv("TEMPORAL_API_KEY"); key != "" {
		options.Credentials = client.NewAPIKeyStaticCredentials(key)
		options.ConnectionOptions.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	temporal, e := client.Dial(options)
	if e != nil {
		return e
	}
	defer temporal.Close()
	w := tw.New(temporal, pw.Queue, tw.Options{MaxConcurrentActivityExecutionSize: 2, WorkerStopTimeout: 5 * time.Second})
	w.RegisterWorkflow(pw.Pipeline)
	w.RegisterActivity(&pw.Activities{Store: db})
	if e = w.Start(); e != nil {
		return e
	}
	defer w.Stop()
	go pw.Dispatch(ctx, db, temporal)
	app := &server.Server{Store: db, Origin: env("APP_ORIGIN", "http://localhost:3000"), Secure: os.Getenv("APP_ENV") == "production"}
	srv := &http.Server{Addr: env("LISTEN_ADDR", "127.0.0.1:8080"), Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("PromptShip API ready", "address", srv.Addr)
	e = srv.ListenAndServe()
	if e == http.ErrServerClosed {
		return nil
	}
	return e
}
