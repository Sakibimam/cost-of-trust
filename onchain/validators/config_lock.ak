use cardano/transaction.{OutputReference, Transaction}

validator config_lock {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _own_ref: OutputReference,
    _tx: Transaction,
  ) {
    fail
  }

  else(_) {
    fail
  }
}
