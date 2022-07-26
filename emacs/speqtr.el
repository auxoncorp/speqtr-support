;;; speqtr.el --- An emacs major mode for the SpeQTr specification and query language   -*- lexical-binding: t; -*-

(define-generic-mode
  ;; name of mode
  'speqtr-mode

  ;; comments
  '(("#" . nil))

  ;; keyword list
  '("->" "<-" "!->" "<-!" "within" "as"
    "when" "recovery" "nominal" "case"
    "and" "or" "true" "false" "_" "behavior" "behaviour" "end"
    "unspecified" "in" "until" "prohibited")

  ;; font-lock list
  '(
    ;; event@loc
    ("[[:word:]_]+@[[:word:]_]+" . 'font-lock-function-name-face)
    ("*@[[:word:]_]+" . 'font-lock-function-name-face)
    ("[[:word:]_]+@\\*" . 'font-lock-function-name-face)

    ;; label declaration
    ("as[[:space:]]+\\(\\w+\\)" 1 'font-lock-constant-face)

    ;; label dereference
    ("\\(\\w+\\)\\." 1 'font-lock-constant-face)

    ;; unification symbols
    ("\?\\w+" . 'font-lock-variable-name-face)
    )

  ;; auto-mode list
  '("\\.speqtr$")

  ;; function list
  nil

  ;; documentation
  "Mode for editing modality spec files")
