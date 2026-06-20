package graphql

import "github.com/tasuku43/vivi/server/application"

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require
// here.

type Resolver struct {
	service *application.Service
}

func NewResolver(service *application.Service) *Resolver {
	return &Resolver{service: service}
}
