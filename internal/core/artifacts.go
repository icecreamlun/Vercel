package core

import (
	"fmt"
	"os"
	"path/filepath"
)

func BundleDirectory() string {
	if path := os.Getenv("BUNDLE_DIR"); path != "" {
		return path
	}
	return "dist/bundles"
}

func VerifyBundle(directory, hash string) error {
	if len(hash) != 64 {
		return fmt.Errorf("invalid bundle hash")
	}
	for _, c := range hash {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return fmt.Errorf("invalid bundle hash")
		}
	}
	bytes, err := os.ReadFile(filepath.Join(directory, hash+".mjs"))
	if err != nil {
		return fmt.Errorf("runner bundle unavailable")
	}
	if Hash(bytes) != hash {
		return fmt.Errorf("runner bundle integrity mismatch")
	}
	return nil
}

// Install this build into a persistent content-addressed archive. Never replace
// an old bundle: releases must continue to execute the bytes they were tested on.
func ArchiveBundles() error {
	source := "dist/bundles"
	target := BundleDirectory()
	if source == target {
		return nil
	}
	if err := os.MkdirAll(target, 0750); err != nil {
		return err
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".mjs" {
			continue
		}
		hash := entry.Name()[:len(entry.Name())-4]
		if err = VerifyBundle(source, hash); err != nil {
			return err
		}
		destination := filepath.Join(target, entry.Name())
		if _, err = os.Stat(destination); err == nil {
			if err = VerifyBundle(target, hash); err != nil {
				return err
			}
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		bytes, err := os.ReadFile(filepath.Join(source, entry.Name()))
		if err != nil {
			return err
		}
		if err = os.WriteFile(destination+".tmp", bytes, 0640); err != nil {
			return err
		}
		if err = os.Rename(destination+".tmp", destination); err != nil {
			return err
		}
	}
	return nil
}
