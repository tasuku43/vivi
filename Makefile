.PHONY: check validate typecheck test eval e2e build storybook storybook-build

check:
	task check

validate:
	task validate

typecheck:
	task typecheck

test:
	task test

eval:
	task eval

e2e:
	task e2e

build:
	task build

storybook:
	task storybook

storybook-build:
	task storybook:build
