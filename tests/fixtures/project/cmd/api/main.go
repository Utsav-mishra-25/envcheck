package main

import (
	"fmt"
	"os"
)

// Go: os.Getenv with double quotes and backticks, os.LookupEnv.
func main() {
	url := os.Getenv("DATABASE_URL")
	token := os.Getenv(`GO_SERVICE_TOKEN`)
	region, ok := os.LookupEnv("DEPLOY_REGION")
	fmt.Println(url, token, region, ok)
}
