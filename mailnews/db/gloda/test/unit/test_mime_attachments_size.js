/* ***** BEGIN LICENSE BLOCK *****
 *   Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Thunderbird Global Database.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Jonathan Protzenko <jonathan.protzenko@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * General testing of the byte-counting libmime facility, to make sure that what
 * is streamed to us is actually labeled with the right size.
 */

/*
 * Do not include glodaTestHelper because we do not want gloda loaded and it
 *  adds a lot of runtime overhead which makes certain debugging strategies like
 *  using chronicle-recorder impractical.
 */
load("../../mailnews/resources/mailDirService.js");
load("../../mailnews/resources/mailTestUtils.js");
load("../../mailnews/resources/logHelper.js");
load("../../mailnews/resources/asyncTestUtils.js");

load("../../mailnews/resources/messageGenerator.js");
load("../../mailnews/resources/messageModifier.js");
load("../../mailnews/resources/messageInjection.js");

// Create a message generator
const msgGen = gMessageGenerator = new MessageGenerator();
// Create a message scenario generator using that message generator
const scenarios = gMessageScenarioFactory = new MessageScenarioFactory(msgGen);

Components.utils.import("resource:///modules/gloda/mimemsg.js");

var htmlText = "<html><head></head><body>I am HTML! Woo! </body></html>";

var partHtml = new SyntheticPartLeaf(
  htmlText,
  {
    contentType: "text/html"
  }
);

var originalText =
  "Longtemps, je me suis couché de bonne heure. Parfois, à "+
  "peine ma bougie éteinte, mes yeux se fermaient si vite que je n'avais pas le "+
  "temps de me dire : « Je m'endors. »";

var b64Text =
  "TG9uZ3RlbXBzLCBqZSBtZSBzdWlzIGNvdWNow6kgZGUgYm9ubmUgaGV1cmUuIFBhcmZvaXMs\n"+
  "IMOgIHBlaW5lIG1hIGJvdWdpZSDDqXRlaW50ZSwgbWVzIHlldXggc2UgZmVybWFpZW50IHNp\n"+
  "IHZpdGUgcXVlIGplIG4nYXZhaXMgcGFzIGxlIHRlbXBzIGRlIG1lIGRpcmUgOiDCqyBKZSBt\n"+
  "J2VuZG9ycy4gwrsK";

var qpText =
  "Longtemps,=20je=20me=20suis=20couch=C3=A9=20de=20bonne=20heure.=20Parfois,=\n"+
  "=20=C3=A0=20peine=20ma=20bougie=20=C3=A9teinte,=20mes=20yeux=20se=20fermaie=\n"+
  "nt=20si=20vite=20que=20je=20n'avais=20pas=20le=20temps=20de=20me=20dire=20:=\n"+
  "=20=C2=AB=20Je=20m'endors.=20=C2=BB";

var uuText =
  "begin 666 -\n"+
  "M3&]N9W1E;7!S+\"!J92!M92!S=6ES(&-O=6-HPZD@9&4@8F]N;F4@:&5U<F4N\n"+
  "M(%!A<F9O:7,L(,.@('!E:6YE(&UA(&)O=6=I92##J71E:6YT92P@;65S('EE\n"+
  "M=7@@<V4@9F5R;6%I96YT('-I('9I=&4@<75E(&IE(&XG879A:7,@<&%S(&QE\n"+
  "G('1E;7!S(&1E(&UE(&1I<F4@.B#\"JR!*92!M)V5N9&]R<RX@PKL*\n"+
  "\n"+
  "end";

var yencText =
  "Hello there --\n"+
  "=ybegin line=128 size=174 name=jane.doe\n"+
  "\x76\x99\x98\x91\x9e\x8f\x97\x9a\x9d\x56\x4a\x94\x8f\x4a\x97\x8f"+
  "\x4a\x9d\x9f\x93\x9d\x4a\x8d\x99\x9f\x8d\x92\xed\xd3\x4a\x8e\x8f"+
  "\x4a\x8c\x99\x98\x98\x8f\x4a\x92\x8f\x9f\x9c\x8f\x58\x4a\x7a\x8b"+
  "\x9c\x90\x99\x93\x9d\x56\x4a\xed\xca\x4a\x9a\x8f\x93\x98\x8f\x4a"+
  "\x97\x8b\x4a\x8c\x99\x9f\x91\x93\x8f\x4a\xed\xd3\x9e\x8f\x93\x98"+
  "\x9e\x8f\x56\x4a\x97\x8f\x9d\x4a\xa3\x8f\x9f\xa2\x4a\x9d\x8f\x4a"+
  "\x90\x8f\x9c\x97\x8b\x93\x8f\x98\x9e\x4a\x9d\x93\x4a\xa0\x93\x9e"+
  "\x8f\x4a\x9b\x9f\x8f\x4a\x94\x8f\x4a\x98\x51\x8b\xa0\x8b\x93\x9d"+
  "\x0d\x0a\x4a\x9a\x8b\x9d\x4a\x96\x8f\x4a\x9e\x8f\x97\x9a\x9d\x4a"+
  "\x8e\x8f\x4a\x97\x8f\x4a\x8e\x93\x9c\x8f\x4a\x64\x4a\xec\xd5\x4a"+
  "\x74\x8f\x4a\x97\x51\x8f\x98\x8e\x99\x9c\x9d\x58\x4a\xec\xe5\x34"+
  "\x0d\x0a"+
  "=yend size=174 crc32=7efccd8e\n";

// that completely exotic encoding is only detected if there is no content type
// on the message, which is usually the case in newsgroups. I hate you yencode!
var partYencText = new SyntheticPartLeaf("I am text! Woo!\n\n"+yencText,
  { contentType: '' } );

var tachText = {filename: 'bob.txt', body: originalText};

var tachInlineText = {filename: 'foo.txt', body: originalText,
                      format: null, charset: null,
                      disposition: 'inline'};

// images have a different behavior than other attachments: they are displayed
// inline most of the time, so there are two different code paths that need to
// enable streaming and byte counting to the JS mime emitter

var tachImage = {filename: 'bob.png', contentType: 'image/png',
                 encoding: 'base64', charset: null, format: null,
                 body: b64Text};

var tachPdf = {filename: 'bob.pdf', contentType: 'application/pdf',
                 encoding: 'base64', charset: null, format: null,
                 body: b64Text};

var tachUU = {filename: 'john.doe', contentType: 'application/x-uuencode',
                 encoding: 'uuencode', charset: null, format: null,
                 body: uuText};

var tachApplication = {filename: 'funky.funk',
                       contentType: 'application/x-funky', body: originalText};

var relImage = {contentType: 'image/png',
                encoding: 'base64', charset: null, format: null,
                contentId: 'part1.foo@bar.com',
                body: b64Text};
var partRelImage = new SyntheticPartLeaf(relImage.body, relImage);

var messageInfos = [
  // encoding type specific to newsgroups, not interested, gloda doesn't even
  // treat this as an attachment (probably because gloda requires an attachment
  // to have a content-type, which these yencoded parts don't have), but size IS
  // counted properly nonetheless
  /*{
    name: 'text/plain with yenc inline',
    bodyPart: partYencText,
    subject: "yEnc-Prefix: \"jane.doe\" 174 yEnc bytes - yEnc test (1)",
  },*/
  // inline image, not interested either, gloda doesn't keep that as an
  // attachment (probably a deliberate choice), size is NOT counted properly
  // (don't want to investigate, I doubt it's a useful information anyway)
  /*{
    name: 'multipart/related',
    bodyPart: new SyntheticPartMultiRelated([partHtml, partRelImage]),
  },*/
  // all of the other common cases work fine
  {
    name: 'text/plain w/app attachment (=> multipart/mixed)',
    bodyPart: partHtml,
    attachments: [tachImage, tachPdf, tachUU,
      tachApplication, tachText, tachInlineText,],
  },
];

function check_attachments(aMimeMsg) {
  if (aMimeMsg == null)
    do_throw("We really should have gotten a result!");

  /* Today's gory details: libmime somehow counts the trailing newline for an
   * attachment MIME part. Most of the time, assuming attachment has N bytes (no matter
   * what's inside, newlines or not), libmime will return N + 1 bytes. On Linux
   * and Mac, this always holds. However, on Windows, if the attachment is not
   * encoded (that is, is inline text), libmime will return N + 2 bytes.
   *
   * This means on Windows, att.size = 175 for application/x-funky, 174 for
   * other test attachments (and the real size is 173 bytes).
   */
  let epsilon = ("@mozilla.org/windows-registry-key;1" in Components.classes) ? 2 : 1;

  do_check_true(aMimeMsg.allAttachments.length > 0);

  let totalSize = htmlText.length;

  for each (let [i, att] in Iterator(aMimeMsg.allAttachments)) {
    dump("*** Attachment now is "+att.name+"\n");
    do_check_true((att.size - originalText.length) <= epsilon);
    totalSize += att.size;
  }

  do_check_true((aMimeMsg.size - totalSize) <= epsilon);

  async_driver();
}

function test_message_attachments(info) {
  let synMsg = gMessageGenerator.makeMessage(info);
  let synSet = new SyntheticMessageSet([synMsg]);
  yield add_sets_to_folder(gInbox, [synSet]);

  let msgHdr = synSet.getMsgHdr(0);
  dump(synMsg.toMboxString()+"\n");

  MsgHdrToMimeMessage(msgHdr, null, function(aMsgHdr, aMimeMsg) {
    try {
      check_attachments(aMimeMsg);
    } catch (e) {
      do_throw(e);
    }
  });

  yield false;
}

/* ===== Driver ===== */

var tests = [
  parameterizeTest(test_message_attachments, messageInfos),
];

var gInbox;

function run_test() {
  // use mbox injection because the fake server chokes sometimes right now
  gInbox = configure_message_injection({mode: "local"});
  async_run_tests(tests);
}
