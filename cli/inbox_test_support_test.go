package main

type commentActivityOutput struct {
	ID             string      `json:"id"`
	ThreadID       string      `json:"threadId"`
	Type           string      `json:"type"`
	Actor          actorOutput `json:"actor"`
	CommentID      string      `json:"commentId,omitempty"`
	PreviousStatus string      `json:"previousStatus,omitempty"`
	Status         string      `json:"status,omitempty"`
	ClientEventID  string      `json:"clientEventId,omitempty"`
	LeaseExpiresAt string      `json:"leaseExpiresAt,omitempty"`
	CreatedAt      string      `json:"createdAt"`
}
