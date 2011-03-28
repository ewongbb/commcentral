/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
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
 * The Original Code is the Instantbird messenging client, released
 * 2010.
 *
 * The Initial Developer of the Original Code is
 * Florian QUEZE <florian@instantbird.org>.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/imServices.jsm");

XPCOMUtils.defineLazyGetter(this, "DBConn",
                            function() Services.core.storageConnection);

var AccountsById = { };
function getAccountById(aId) {
  if (AccountsById.hasOwnProperty(aId))
    return AccountsById[aId];

  let account = null;
  try {
    account = Services.core.getAccountByNumericId(aId);
  } catch (x) { /* Not found */ }

  AccountsById[aId] = account;
  return account;
}

function TagsService() { }
TagsService.prototype = {
  get wrappedJSObject() this,
  createTag: function(aName) {
    // If the tag already exists, we don't want to create a duplicate.
    let tag = this.getTagByName(aName);
    if (tag)
      return tag;

    let statement = DBConn.createStatement("INSERT INTO tags (name, position) VALUES(:name, 0)");
    statement.params.name = aName;
    statement.executeStep();

    tag = new Tag(DBConn.lastInsertRowID, aName);
    Tags.push(tag);
    return tag;
  },
  // Get an existing tag by (numeric) id. Returns null if not found.
  getTagById: function(aId) TagsById[aId],
  // Get an existing tag by name (will do an SQL query). Returns null
  // if not found.
  getTagByName: function(aName) {
    let statement = DBConn.createStatement("SELECT id FROM tags where name = :name");
    statement.params.name = aName;
    if (!statement.executeStep())
      return null;
    return this.getTagById(statement.row.id);
  },
  // Get an array of all existing tags.
  getTags: function(aTagCount) {
    if (aTagCount)
      aTagCount.value = Tags.length;
    return Tags;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imITagsService]),
  classDescription: "Tags",
  classID: Components.ID("{1fa92237-4303-4384-b8ac-4e65b50810a5}"),
  contractID: "@instantbird.org/purple/tags-service;1"
};

// TODO move into the tagsService
var Tags = [];
var TagsById = { };

function Tag(aId, aName) {
  this._id = aId;
  this._name = aName;
  this._contacts = [];
  this._observers = [];

  TagsById[this.id] = this;
}
Tag.prototype = {
  get id() this._id,
  get name() this._name,
  set name(aNewName) {
    var statement = DBConn.createStatement("UPDATE tags SET name = :name WHERE id = :id");
    statement.params.name = aNewName;
    statement.params.id = this._id;
    statement.execute();

    //FIXME move the account buddies if some use this tag as their group
    return aNewName;
  },
  getContacts: function(aContactCount) {
    let contacts = this._contacts.filter(function(c) !c._empty);
    if (aContactCount)
      aContactCount.value = contacts.length;
    return contacts;
  },
  _addContact: function (aContact) {
    this._contacts.push(aContact);
  },
  _removeContact: function (aContact) {
    let index = this._contacts.indexOf(aContact);
    if (index != -1)
      this._contacts.splice(index, 1);
  },

  addObserver: function(aObserver) {
    if (this._observers.indexOf(aObserver) == -1)
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    let index = this._observers.indexOf(aObserver);
    if (index != -1)
      this._observers.splice(index, 1);
  },
  notifyObservers: function(aSubject, aTopic, aData) {
    for each (let observer in this._observers)
      observer.observe(aSubject, aTopic, aData);
  },

  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.imITag];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.imITag, Ci.nsIClassInfo])
};

var ContactsById = { };
var LastDummyContactId = 0;
function Contact(aId, aAlias) {
  // Assign a negative id to dummy contacts that have a single buddy
  this._id = aId || --LastDummyContactId;
  this._alias = aAlias;
  this._tags = [];
  this._buddies = [];
  this._observers = [];

  ContactsById[this._id] = this;
}
Contact.prototype = {
  _id: 0,
  get id() this._id,
  get alias() this._alias,
  set alias(aNewAlias) {
    this._ensureNotDummy();

    let statement = DBConn.createStatement("UPDATE contacts SET alias = :alias WHERE id = :id");
    statement.params.alias = aNewAlias;
    statement.params.id = this._id;
    statement.executeAsync();

    let oldDisplayName = this.displayName;
    this._alias = aNewAlias;
    this._notifyObservers("display-name-changed", oldDisplayName);
    for each (let buddy in this._buddies)
      for each (let accountBuddy in buddy._accounts)
        accountBuddy.serverAlias = aNewAlias;
    return aNewAlias;
  },
  _ensureNotDummy: function() {
    if (this._id >= 0)
      return;

    // Create a real contact for this dummy contact
    let statement = DBConn.createStatement("INSERT INTO contacts DEFAULT VALUES");
    statement.execute();
    delete ContactsById[this._id];
    let oldId = this._id;
    this._id = DBConn.lastInsertRowID;
    ContactsById[this._id] = this;
    this._notifyObservers("no-longer-dummy", oldId.toString());
    // Update the contact_id for the single existing buddy of this contact
    statement = DBConn.createStatement("UPDATE buddies SET contact_id = :id WHERE id = :buddy_id");
    statement.params.id = this._id;
    statement.params.buddy_id = this._buddies[0].id;
    statement.executeAsync();
  },

  getTags: function(aTagCount) {
    if (aTagCount)
      aTagCount.value = this._tags.length;
    return this._tags;
  },
  addTag: function(aTag, aInherited) {
    if (this.hasTag(aTag))
      return;

    if (!aInherited) {
      this._ensureNotDummy();
      let statement =
        DBConn.createStatement("INSERT INTO contact_tag (contact_id, tag_id) " +
                               "VALUES(:contactId, :tagId)");
      statement.params.contactId = this.id;
      statement.params.tagId = aTag.id;
      statement.executeAsync();
    }

    aTag = TagsById[aTag.id];
    this._tags.push(aTag);
    aTag._addContact(this);

    aTag.notifyObservers(this, "contact-moved-in");
    for each (let observer in this._observers)
      observer.observe(aTag, "contact-moved-in");
    Services.obs.notifyObservers(this, "contact-tagged", aTag.id);
  },
  /* Remove a tag from the local tags of the contact. */
  _removeTag: function(aTag) {
    if (!this.hasTag(aTag) || this._isTagInherited(aTag))
      return;

    let statement = DBConn.createStatement("DELETE FROM contact_tag " +
                                           "WHERE contact_id = :contactId " +
                                           "AND tag_id = :tagId");
    statement.params.contactId = this.id;
    statement.params.tagId = aTag.id;
    statement.executeAsync();

    this._tags = this._tags.filter(function(tag) tag.id != aTag.id);
    aTag = TagsById[aTag.id];
    aTag._removeContact(this);

    aTag.notifyObservers(this, "contact-moved-out");
    for each (let observer in this._observers)
      observer.observe(aTag, "contact-moved-out");
  },
  hasTag: function(aTag) this._tags.some(function (t) t.id == aTag.id),
  _massMove: false,
  move: function(aOldTag, aNewtag) {
    if (!this.hasTag(aOldTag))
      throw "Attempting to remove a tag that the contact doesn't have";

    this._massMove = true;
    let moved = false;
    this._buddies.forEach(function (aBuddy) {
      aBuddy._accounts.forEach(function (aAccountBuddy) {
        if (aAccountBuddy.tag.id == aOldTag.id) {
          if (aBuddy._accounts.some(function(ab)
               ab.account.numericId == aAccountBuddy.account.numericId &&
               ab.tag.id == aNewtag.id)) {
            aAccountBuddy.remove();
            moved = true;
          }
          else {
            try {
              aAccountBuddy.tag = aNewtag;
              moved = true;
            } catch (e) {
              // Ignore failures. Some protocol plugins may not implement this.
            }
          }
        }
      });
    });
    this._massMove = false;
    if (moved)
      this._moved(aOldTag, aNewtag);
    else {
      // If we are here, the old tag is not inherited from a buddy, so
      // just add the new tag as a local tag.
      this.addTag(aNewtag);
      this._removeTag(aOldTag);
    }
  },
  _isTagInherited: function(aTag) {
    for each (let buddy in this._buddies)
      for each (let accountBuddy in buddy._accounts)
        if (accountBuddy.tag.id == aTag.id)
          return true;
    return false;
  },
  _moved: function(aOldTag, aNewTag) {
    if (this._massMove)
      return;

    // Avoid xpconnect wrappers.
    aNewTag = aNewTag && TagsById[aNewTag.id];
    aOldTag = aOldTag && TagsById[aOldTag.id];

    // Decide what we need to do. Return early if nothing to do.
    let shouldRemove =
      aOldTag && this.hasTag(aOldTag) && !this._isTagInherited(aOldTag);
    let shouldAdd =
      aNewTag && !this.hasTag(aNewTag) && this._isTagInherited(aNewTag);
    if (!shouldRemove && !shouldAdd)
      return;

    // Apply the changes.
    let tags = this._tags;
    if (shouldRemove) {
      tags = tags.filter(function(aTag) aTag.id != aOldTag.id);
      aOldTag._removeContact(this);
    }
    if (shouldAdd) {
      tags.push(aNewTag);
      aNewTag._addContact(this);
    }
    this._tags = tags;

    // Finally, notify of the changes.
    if (shouldRemove) {
      aOldTag.notifyObservers(this, "contact-moved-out");
      for each (let observer in this._observers)
        observer.observe(aOldTag, "contact-moved-out");
    }
    if (shouldAdd) {
      aNewTag.notifyObservers(this, "contact-moved-in");
      for each (let observer in this._observers)
        observer.observe(aNewTag, "contact-moved-in");
    }
    Services.obs.notifyObservers(this, "contact-moved", null);
  },

  getBuddies: function(aBuddyCount) {
    if (aBuddyCount)
      aBuddyCount.value = this._buddies.length;
    return this._buddies;
  },
  get _empty() this._buddies.length == 0 ||
               this._buddies.every(function(b) b._empty),

  mergeContact: function(aContact) {
    // Avoid merging the contact with itself or merging into an
    // already removed contact.
    if (aContact.id == this.id || !(this.id in ContactsById))
      throw Components.results.NS_ERROR_INVALID_ARG;

    this._ensureNotDummy();
    let contact = ContactsById[aContact.id]; // remove XPConnect wrapper

    // Copy all the contact-only tags first, otherwise they would be lost.
    for each (let tag in contact.getTags())
      if (!contact._isTagInherited(tag))
        this.addTag(tag);

    // Adopt each buddy. Removing the last one will delete the contact.
    for each (let buddy in contact.getBuddies())
      buddy.contact = this;
    this._updatePreferredBuddy();
  },
  moveBuddyBefore: function(aBuddy, aBeforeBuddy) {
    let buddy = BuddiesById[aBuddy.id]; // remove XPConnect wrapper
    let oldPosition = this._buddies.indexOf(buddy);
    if (oldPosition == -1)
      throw "aBuddy isn't attached to this contact";

    let newPosition = -1;
    if (aBeforeBuddy)
      newPosition = this._buddies.indexOf(BuddiesById[aBeforeBuddy.id]);
    if (newPosition == -1)
      newPosition = this._buddies.length - 1;

    if (oldPosition == newPosition)
      return;

    this._buddies.splice(oldPosition, 1);
    this._buddies.splice(newPosition, 0, buddy);
    this._updatePositions(Math.min(oldPosition, newPosition),
                          Math.max(oldPosition, newPosition));
    buddy._notifyObservers("position-changed", String(newPosition));
    this._updatePreferredBuddy(buddy);
  },
  adoptBuddy: function(aBuddy) {
    if (aBuddy.contact.id == this.id)
      throw Components.results.NS_ERROR_INVALID_ARG;

    let buddy = BuddiesById[aBuddy.id]; // remove XPConnect wrapper
    buddy.contact = this;
    this._updatePreferredBuddy(buddy);
  },
  _massRemove: false,
  _removeBuddy: function(aBuddy) {
    if (this._buddies.length == 1) {
      if (this._id > 0) {
        let statement =
          DBConn.createStatement("DELETE FROM contacts WHERE id = :id");
        statement.params.id = this._id;
        statement.executeAsync();
      }
      this._notifyObservers("removed");
      delete ContactsById[this._id];

      for each (let tag in this._tags)
        tag._removeContact(this);
      let statement =
        DBConn.createStatement("DELETE FROM contact_tag WHERE contact_id = :id");
      statement.params.id = this._id;
      statement.executeAsync();

      delete this._tags;
      delete this._buddies;
      delete this._observers;
    }
    else {
      let index = this._buddies.indexOf(aBuddy);
      if (index == -1)
        throw "Removing an unknown buddy from contact " + this._id;

      this._buddies.splice(index, 1);

      // If we are actually removing the whole contact, don't bother updating
      // the positions or the preferred buddy.
      if (this._massRemove)
        return;

      // No position to update if the removed buddy is at the last position.
      if (index < this._buddies.length)
        this._updatePositions(index);

      if (this._preferredBuddy.id == aBuddy.id)
        this._updatePreferredBuddy();
    }
  },
  _updatePositions: function(aIndexBegin, aIndexEnd) {
    if (aIndexEnd === undefined)
      aIndexEnd = this._buddies.length - 1;
    if (aIndexBegin > aIndexEnd)
      throw "_updatePositions: Invalid indexes";

    let statement =
      DBConn.createStatement("UPDATE buddies SET position = :position " +
                             "WHERE id = :buddyId");
    for (let i = aIndexBegin; i <= aIndexEnd; ++i) {
      statement.params.position = i;
      statement.params.buddyId = this._buddies[i].id;
      statement.executeAsync();
    }
  },

  detachBuddy: function(aBuddy) {
    // Should return a new contact with the same list of tags.
    let buddy = BuddiesById[aBuddy.id];
    if (buddy.contact.id != this.id)
      throw Components.results.NS_ERROR_INVALID_ARG;
    if (buddy.contact._buddies.length == 1)
      throw Components.results.NS_ERROR_UNEXPECTED;

    // Save the list of tags, it may be destoyed if the buddy was the last one.
    let tags = buddy.contact.getTags();

    // Create a new dummy contact and use it for the detached buddy.
    buddy.contact = new Contact();

    // The first tag was inherited during the contact setter.
    // This will copy the remaining tags.
    for each (let tag in tags)
      buddy.contact.addTag(tag);

    return buddy.contact;
  },
  remove: function() {
    this._massRemove = true;
    for each (let buddy in this._buddies)
      buddy.remove();
  },

  // imIStatusInfo implementation
  _preferredBuddy: null,
  get preferredBuddy() {
    if (!this._preferredBuddy)
      this._updatePreferredBuddy();
    return this._preferredBuddy;
  },
  set preferredBuddy(aBuddy) {
    let shouldNotify = this._preferredBuddy != null;
    let oldDisplayName =
      this._preferredBuddy && this._preferredBuddy.displayName;
    this._preferredBuddy = aBuddy;
    if (shouldNotify)
      this._notifyObservers("preferred-buddy-changed");
    if (oldDisplayName && this._preferredBuddy.displayName != oldDisplayName)
      this._notifyObservers("display-name-changed", oldDisplayName);
    this._updateStatus();
  },
  // aBuddy indicate which buddy's availability has changed.
  _updatePreferredBuddy: function(aBuddy) {
    if (aBuddy) {
      aBuddy = BuddiesById[aBuddy.id]; // remove potential XPConnect wrapper

      if (!this._preferredBuddy) {
        this.preferredBuddy = aBuddy;
        return;
      }

      if (aBuddy.id == this._preferredBuddy.id) {
        // The suggested buddy is already preferred, check if its
        // availability has changed.
        if (aBuddy.statusType > this._statusType ||
            (aBuddy.statusType == this._statusType &&
             aBuddy.availabilityDetails >= this._availabilityDetails)) {
          // keep the currently preferred buddy, only update the status.
          this._updateStatus();
          return;
        }
        // We aren't sure that the currently preferred buddy should
        // still be preferred. Let's go through the list!
      }
      else {
        // The suggested buddy is not currently preferred. If it is
        // more available or at a better position, prefer it!
        if (aBuddy.statusType > this._statusType ||
            (aBuddy.statusType == this._statusType &&
             (aBuddy.availabilityDetails > this._availabilityDetails ||
              (aBuddy.availabilityDetails == this._availabilityDetails &&
               this._buddies.indexOf(aBuddy) < this._buddies.indexOf(this.preferredBuddy)))))
          this.preferredBuddy = aBuddy;
        return;
      }
    }

    let preferred;
    // |this._buddies| is ordered by user preference, so in case of
    // equal availability, keep the current value of |preferred|.
    for each (let buddy in this._buddies) {
      if (!preferred || preferred.statusType < buddy.statusType ||
          (preferred.statusType == buddy.statusType &&
           preferred.availabilityDetails < buddy.availabilityDetails))
        preferred = buddy;
    }
    if (preferred && (!this._preferredBuddy ||
                      preferred.id != this._preferredBuddy.id))
      this.preferredBuddy = preferred;
  },
  _updateStatus: function() {
    let buddy = this._preferredBuddy; // for convenience

    // Decide which notifications should be fired.
    let notifications = [];
    if (this._statusType != buddy.statusType ||
        this._availabilityDetails != buddy.availabilityDetails)
      notifications.push("availability-changed");
    if (this._statusType != buddy.statusType ||
        this._statusText != buddy.statusText) {
      notifications.push("status-changed");
      if (this.online && buddy.statusType <= Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-off");
      if (!this.online && buddy.statusType > Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-on");
    }

    // Actually change the stored status.
    [this._statusType, this._statusText, this._availabilityDetails] =
      [buddy.statusType, buddy.statusText, buddy.availabilityDetails];

    // Fire the notifications.
    notifications.forEach(function(aTopic) {
      this._notifyObservers(aTopic);
    }, this);
  },
  get displayName() this._alias || this.preferredBuddy.displayName,
  get buddyIconFilename() this.preferredBuddy.buddyIconFilename,
  _statusType: 0,
  get statusType() this._statusType,
  get online() this.statusType > Ci.imIStatusInfo.STATUS_OFFLINE,
  get available() this.statusType == Ci.imIStatusInfo.STATUS_AVAILABLE,
  get idle() this.statusType == Ci.imIStatusInfo.STATUS_IDLE,
  get mobile() this.statusType == Ci.imIStatusInfo.STATUS_MOBILE,
  _statusText: "",
  get statusText() this._statusText,
  _availabilityDetails: 0,
  get availabilityDetails() this._availabilityDetails,
  get canSendMessage() this.preferredBuddy.canSendMessage,
  //XXX should we list the buddies in the tooltip?
  getTooltipInfo: function() this.preferredBuddy.getTooltipInfo(),
  createConversation: function() {
    let uiConv = Services.conversations.getUIConversationByContactId(this.id);
    if (uiConv)
      return uiConv.target;
    return this.preferredBuddy.createConversation();
  },

  addObserver: function(aObserver) {
    if (this._observers.indexOf(aObserver) == -1)
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    if (!this.hasOwnProperty("_observers"))
      return;

    let index = this._observers.indexOf(aObserver);
    if (index != -1)
      this._observers.splice(index, 1);
  },
  // internal calls + calls from add-ons
  notifyObservers: function(aSubject, aTopic, aData) {
    for each (let observer in this._observers)
      observer.observe(aSubject, aTopic, aData);
    for each (let tag in this._tags)
      tag.notifyObservers(aSubject, aTopic, aData);
    Services.obs.notifyObservers(aSubject, aTopic, aData);
  },
  _notifyObservers: function(aTopic, aData) {
    this.notifyObservers(this, "contact-" + aTopic, aData);
  },

  // This is called by the imIBuddy implementations.
  _observe: function(aSubject, aTopic, aData) {
    // Forward the notification.
    this.notifyObservers(aSubject, aTopic, aData);

    let isPreferredBuddy =
      aSubject instanceof Buddy && aSubject.id == this.preferredBuddy.id;
    switch (aTopic) {
      case "buddy-availability-changed":
        this._updatePreferredBuddy(aSubject);
        break;
      case "buddy-status-changed":
        if (isPreferredBuddy)
          this._updateStatus();
        break;
      case "buddy-display-name-changed":
        if (isPreferredBuddy && !this._alias)
          this._notifyObservers("display-name-changed", aData);
        break;
      case "buddy-added":
        // Currently buddies are always added in dummy empty contacts,
        // later we may want to check this._buddies.length == 1.
        this._notifyObservers("added");
        break;
      case "buddy-removed":
        this._removeBuddy(aSubject);
    }
  },

  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.imIContact];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.imIContact, Ci.nsIClassInfo])
};

var BuddiesById = { };
function Buddy(aId, aKey, aName, aSrvAlias, aContactId) {
  this._id = aId;
  this._key = aKey;
  this._name = aName;
  if (aSrvAlias)
    this._srvAlias = aSrvAlias;
  this._accounts = [];
  this._observers = [];

  if (aContactId)
    this._contact = ContactsById[aContactId];
  // Avoid failure if aContactId was invalid.
  if (!this._contact)
    this._contact = new Contact(null, null);

  this._contact._buddies.push(this);

  BuddiesById[this._id] = this;
}
Buddy.prototype = {
  get id() this._id,
  destroy: function() {
    delete this._accounts;
    delete this._observers;
    delete this._preferredAccount;
  },
  get protocol() this._accounts[0].account.protocol,
  get userName() this._name,
  get normalizedName() this._key,
  _srvAlias: "",
  _contact: null,
  get contact() this._contact,
  set contact(aContact) /* not in imIBuddy */ {
    if (aContact.id == this._contact.id)
      throw Components.results.NS_ERROR_INVALID_ARG;

    this._notifyObservers("moved-out-of-contact");
    this._contact._removeBuddy(this);

    this._contact = aContact;
    this._contact._buddies.push(this);

    // Ensure all the inherited tags are in the new contact.
    for each (let accountBuddy in this._accounts)
      this._contact.addTag(TagsById[accountBuddy.tag.id], true);

    let statement =
      DBConn.createStatement("UPDATE buddies SET contact_id = :contactId, " +
                             "position = :position " +
                             "WHERE id = :buddyId");
    statement.params.contactId = aContact.id > 0 ? aContact.id : 0;
    statement.params.position = aContact._buddies.length - 1;
    statement.params.buddyId = this.id;
    statement.executeAsync();

    this._notifyObservers("moved-into-contact");
    return aContact;
  },
  getAccountBuddies: function(aAccountBuddyCount) {
    if (aAccountBuddyCount)
      aAccountBuddyCount.value = this._accounts.length;
    return this._accounts;
  },

  _addAccount: function(aAccountBuddy, aTag) {
    this._accounts.push(aAccountBuddy);
    let contact = this._contact;
    if (this._contact._tags.indexOf(aTag) == -1) {
      this._contact._tags.push(aTag);
      aTag._addContact(contact);
    }

    if (!this._preferredAccount)
      this._preferredAccount = aAccountBuddy;
  },
  get _empty() this._accounts.length == 0,

  remove: function() {
    for each (let account in this._accounts)
      account.remove();
  },

  // imIStatusInfo implementation
  _preferredAccount: null,
  get preferredAccountBuddy() this._preferredAccount,
  _isPreferredAccount: function(aAccountBuddy)
    aAccountBuddy.account.numericId == this._preferredAccount.account.numericId,
  set preferredAccount(aAccount) {
    let oldDisplayName =
      this._preferredAccount && this._preferredAccount.displayName;
    this._preferredAccount = aAccount;
    this._notifyObservers("preferred-account-changed");
    if (oldDisplayName && this._preferredAccount.displayName != oldDisplayName)
      this._notifyObservers("display-name-changed", oldDisplayName);
    this._updateStatus();
  },
  // aAccount indicate which account's availability has changed.
  _updatePreferredAccount: function(aAccount) {
    if (aAccount) {
      if (aAccount.account.numericId == this._preferredAccount.account.numericId) {
        // The suggested account is already preferred, check if its
        // availability has changed.
        if (aAccount.statusType > this._statusType ||
            (aAccount.statusType == this._statusType &&
             aAccount.availabilityDetails >= this._availabilityDetails)) {
          // keep the currently preferred account, only update the status.
          this._updateStatus();
          return;
        }
        // We aren't sure that the currently preferred account should
        // still be preferred. Let's go through the list!
      }
      else {
        // The suggested account is not currently preferred. If it is
        // more available, prefer it!
        if (aAccount.statusType > this._statusType ||
            (aAccount.statusType == this._statusType &&
             aAccount.availabilityDetails > this._availabilityDetails))
          this.preferredAccount = aAccount;
        return;
      }
    }

    let preferred;
    //TODO take into account the order of the account-manager list.
    for each (let account in this._accounts) {
      if (!preferred || preferred.statusType < account.statusType ||
          (preferred.statusType == account.statusType &&
           preferred.availabilityDetails < account.availabilityDetails))
        preferred = account;
    }
    if (!this._preferredAccount) {
      if (preferred)
        this.preferredAccount = preferred;
      return;
    }
    if (preferred.account.numericId != this._preferredAccount.account.numericId)
      this.preferredAccount = preferred;
    else
      this._updateStatus();
  },
  _updateStatus: function() {
    let account = this._preferredAccount; // for convenience

    // Decide which notifications should be fired.
    let notifications = [];
    if (this._statusType != account.statusType ||
        this._availabilityDetails != account.availabilityDetails)
      notifications.push("availability-changed");
    if (this._statusType != account.statusType ||
        this._statusText != account.statusText) {
      notifications.push("status-changed");
      if (this.online && account.statusType <= Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-off");
      if (!this.online && account.statusType > Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-on");
    }

    // Actually change the stored status.
    [this._statusType, this._statusText, this._availabilityDetails] =
      [account.statusType, account.statusText, account.availabilityDetails];

    // Fire the notifications.
    notifications.forEach(function(aTopic) {
      this._notifyObservers(aTopic);
    }, this);
  },
  get displayName() this._preferredAccount && this._preferredAccount.displayName ||
                    this._srvAlias || this._name,
  get buddyIconFilename() this._preferredAccount.buddyIconFilename,
  _statusType: 0,
  get statusType() this._statusType,
  get online() this.statusType > Ci.imIStatusInfo.STATUS_OFFLINE,
  get available() this.statusType == Ci.imIStatusInfo.STATUS_AVAILABLE,
  get idle() this.statusType == Ci.imIStatusInfo.STATUS_IDLE,
  get mobile() this.statusType == Ci.imIStatusInfo.STATUS_MOBILE,
  _statusText: "",
  get statusText() this._statusText,
  _availabilityDetails: 0,
  get availabilityDetails() this._availabilityDetails,
  get canSendMessage() this._preferredAccount.canSendMessage,
  //XXX should we list the accounts in the tooltip?
  getTooltipInfo: function() this._preferredAccount.getTooltipInfo(),
  createConversation: function() this._preferredAccount.createConversation(),

  addObserver: function(aObserver) {
    if (this._observers.indexOf(aObserver) == -1)
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    let index = this._observers.indexOf(aObserver);
    if (index != -1)
      this._observers.splice(index, 1);
  },
  // internal calls + calls from add-ons
  notifyObservers: function(aSubject, aTopic, aData) {
    for each (let observer in this._observers)
      observer.observe(aSubject, aTopic, aData);
    this._contact._observe(aSubject, aTopic, aData);
  },
  _notifyObservers: function(aTopic, aData) {
    this.notifyObservers(this, "buddy-" + aTopic, aData);
  },

  // This is called by the imIAccountBuddy implementations.
  observe: function(aSubject, aTopic, aData) {
    // Forward the notification.
    this.notifyObservers(aSubject, aTopic, aData);

    switch (aTopic) {
      case "account-buddy-availability-changed":
        this._updatePreferredAccount(aSubject);
        break;
      case "account-buddy-status-changed":
        if (this._isPreferredAccount(aSubject))
          this._updateStatus();
        break;
      case "account-buddy-display-name-changed":
        if (this._isPreferredAccount(aSubject)) {
          this._srvAlias =
            this.displayName != this.userName ? this.displayName : "";
          let statement =
            DBConn.createStatement("UPDATE buddies SET srv_alias = :srvAlias " +
                                   "WHERE id = :buddyId");
          statement.params.buddyId = this.id;
          statement.params.srvAlias = this._srvAlias;
          statement.executeAsync();
          this._notifyObservers("display-name-changed", aData);
        }
        break;
      case "account-buddy-added":
        if (this._accounts.length == 0) {
          // Add the new account in the empty buddy instance.
          // The TagsById hack is to bypass the xpconnect wrapper.
          this._addAccount(aSubject, TagsById[aSubject.tag.id]);
          this._updateStatus();
          this._notifyObservers("added");
        }
        else {
          this._accounts.push(aSubject);
          this.contact._moved(null, aSubject.tag);
          this._updatePreferredAccount(aSubject);
        }
        break;
      case "account-buddy-removed":
        if (this._accounts.length == 1) {
          let statement =
            DBConn.createStatement("DELETE FROM buddies WHERE id = :id");
          statement.params.id = this.id;
          statement.execute();

          this._notifyObservers("removed");

          delete BuddiesById[this._id];
          this.destroy();
        }
        else {
          this._accounts = this._accounts.filter(function (ab) {
            return (ab.account.numericId != aSubject.account.numericId ||
                    ab.tag.id != aSubject.tag.id);
          });
          if (this._preferredAccount.account.numericId == aSubject.account.numericId &&
              this._preferredAccount.tag.id == aSubject.tag.id) {
            this._preferredAccount = null;
            this._updatePreferredAccount();
          }
          this.contact._moved(aSubject.tag);
        }
        break;
    }
  },

  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.imIBuddy];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.imIBuddy, Ci.nsIClassInfo])
};


function ContactsService() { }
ContactsService.prototype = {
  initContacts: function() {
    var statement = DBConn.createStatement("SELECT id, name FROM tags");
    while (statement.executeStep())
      Tags.push(new Tag(statement.getInt32(0), statement.getUTF8String(1)));

    statement = DBConn.createStatement("SELECT id, alias FROM contacts");
    while (statement.executeStep())
      new Contact(statement.getInt32(0), statement.getUTF8String(1));

    statement =
      DBConn.createStatement("SELECT contact_id, tag_id FROM contact_tag");
    while (statement.executeStep()) {
      let contact = ContactsById[statement.getInt32(0)];
      let tag = TagsById[statement.getInt32(1)];
      contact._tags.push(tag);
      tag._addContact(contact);
    }

    statement = DBConn.createStatement("SELECT id, key, name, srv_alias, contact_id FROM buddies ORDER BY position");
    while (statement.executeStep())
      new Buddy(statement.getInt32(0), statement.getUTF8String(1),
                statement.getUTF8String(2), statement.getUTF8String(3),
                statement.getInt32(4));
    // FIXME is there a way to enforce that all AccountBuddies of a Buddy have the same protocol?

    statement = DBConn.createStatement("SELECT account_id, buddy_id, tag_id FROM account_buddy");
    while (statement.executeStep()) {
      let account = getAccountById(statement.getInt32(0));
      let buddy = BuddiesById[statement.getInt32(1)];
      let tag = TagsById[statement.getInt32(2)];
      try {
        let ab = account.loadBuddy(buddy, tag);
        if (ab)
          buddy._addAccount(ab, tag);
      } catch (e) {
        // FIXME ab shouldn't be NULL (once purpleAccount is finished)
        // It currently doesn't work write with unknown protocols.
        Components.utils.reportError(e);
        dump(e + "\n");
      }
    }
  },
  unInitContacts: function() {
    AccountsById = { };
    Tags = [];
    TagsById = { };
    // Avoid shutdown leaks caused by references to native components
    // implementing imIAccountBuddy.
    for each (let buddy in BuddiesById)
      buddy.destroy();
    BuddiesById = { };
    ContactsById = { };
  },

  getContactById: function(aId) ContactsById[aId],
  getBuddyById: function(aId) BuddiesById[aId],
  getBuddyByNameAndProtocol: function(aNormalizedName, aPrpl) {
    let statement =
      DBConn.createStatement("SELECT b.id FROM buddies b " +
                             "JOIN account_buddy ab ON buddy_id = b.id " +
                             "JOIN accounts a ON account_id = a.id " +
                             "WHERE b.key = :buddyName and a.prpl = :prplId");
    statement.params.buddyName = aNormalizedName;
    statement.params.prplId = aPrpl.id;
    if (!statement.executeStep())
      return null;
    return BuddiesById[statement.row.id];
  },

  accountBuddyAdded: function(aAccountBuddy) {
    let account = aAccountBuddy.account;
    let normalizedName = aAccountBuddy.normalizedName;
    let buddy = this.getBuddyByNameAndProtocol(normalizedName, account.protocol);
    if (!buddy) {
      let statement =
        DBConn.createStatement("INSERT INTO buddies " +
                               "(key, name, srv_alias, position) " +
                               "VALUES(:key, :name, :srvAlias, 0)");
      let name = aAccountBuddy.userName;
      let srvAlias = aAccountBuddy.serverAlias;
      statement.params.key = normalizedName;
      statement.params.name = name;
      statement.params.srvAlias = srvAlias;
      statement.execute();
      buddy =
        new Buddy(DBConn.lastInsertRowID, normalizedName, name, srvAlias, 0);
    }

    // Initialize the 'buddy' field of the imIAccountBuddy instance.
    aAccountBuddy.buddy = buddy;

    // Store the new account buddy.
    let statement =
      DBConn.createStatement("INSERT INTO account_buddy " +
                             "(account_id, buddy_id, tag_id) " +
                             "VALUES(:accountId, :buddyId, :tagId)");
    statement.params.accountId = account.numericId;
    statement.params.buddyId = buddy.id;
    statement.params.tagId = aAccountBuddy.tag.id;
    statement.execute();

    // Fire the notifications.
    buddy.observe(aAccountBuddy, "account-buddy-added");
  },
  accountBuddyRemoved: function(aAccountBuddy) {
    let buddy = aAccountBuddy.buddy;
    let statement =
      DBConn.createStatement("DELETE FROM account_buddy " +
                                    "WHERE account_id = :accountId AND " +
                                          "buddy_id = :buddyId AND " +
                                          "tag_id = :tagId");
    statement.params.accountId = aAccountBuddy.account.numericId;
    statement.params.buddyId = buddy.id;
    statement.params.tagId = aAccountBuddy.tag.id;
    statement.execute();

    buddy.observe(aAccountBuddy, "account-buddy-removed");
  },

  accountBuddyMoved: function(aAccountBuddy, aOldTag, aNewTag) {
    let buddy = aAccountBuddy.buddy;
    let statement =
      DBConn.createStatement("UPDATE account_buddy " +
                             "SET tag_id = :newTagId " +
                             "WHERE account_id = :accountId AND " +
                                   "buddy_id = :buddyId AND " +
                                   "tag_id = :oldTagId");
    statement.params.accountId = aAccountBuddy.account.numericId;
    statement.params.buddyId = buddy.id;
    statement.params.oldTagId = aOldTag.id;
    statement.params.newTagId = aNewTag.id;
    statement.execute();

    buddy.observe(aAccountBuddy, "account-buddy-moved");
    ContactsById[buddy.contact.id]._moved(aOldTag, aNewTag);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.imIContactsService]),
  classDescription: "Contacts",
  classID: Components.ID("{8c3725dd-ee26-489d-8135-736015af8c7f}"),
  contractID: "@instantbird.org/purple/contacts-service;1"
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([ContactsService,
                                                      TagsService]);
