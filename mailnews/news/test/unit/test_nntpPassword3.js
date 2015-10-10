/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/**
 * Extra tests for forgetting newsgroup usernames and passwords.
 */

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://gre/modules/Services.jsm");

load("../../../resources/passwordStorage.js");

var kUsername = "testnews";
var kPassword = "newstest";
var kProtocol = "nntp";
var kHostname = "localhost";
var kServerUrl = "news://" + kHostname;

add_task(function *() {
  // Prepare files for passwords (generated by a script in bug 1018624).
  yield setupForPassword("signons-mailnews1.8.json")

  // Set up the basic accounts and folders.
  localAccountUtils.loadLocalMailAccount();

  var incomingServer = MailServices.accounts.createIncomingServer(null, kHostname,
                                                                  kProtocol);

  var i;
  var count = {};

  // Test - Check there is a password to begin with...
  var logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  do_check_eq(count.value, 1);
  do_check_eq(logins[0].username, kUsername);
  do_check_eq(logins[0].password, kPassword);

  // Test - Remove the news password login via the incoming server
  incomingServer.forgetPassword();

  logins = Services.logins.findLogins(count, kServerUrl, null, kServerUrl);

  // should be no passwords left...
  do_check_eq(count.value, 0);
});

function run_test() {
  run_next_test();
}
