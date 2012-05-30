/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsIContentHandler.h"
#include "nsIURI.h"

class nsMessengerContentHandler : public nsIContentHandler
{
public:
  nsMessengerContentHandler();
  virtual ~nsMessengerContentHandler();
  
  NS_DECL_ISUPPORTS
  NS_DECL_NSICONTENTHANDLER
    
private:
  nsresult OpenWindow(nsIURI* aURI);
};
