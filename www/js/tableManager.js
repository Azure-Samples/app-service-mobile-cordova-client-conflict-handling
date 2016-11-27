/**
 * Module performs all table related operations
 */

define(['./lib/es6-promise'], function(es6) {

    var client,
        store,
        syncContext,
        tableName = 'todoitem',
        Promise = es6.Promise,
        uiManager,
        isInitialized;

    function setUiManager(manager) {
        uiManager = manager;
    }

    function setup() {
        if (isInitialized) {
            return Promise.resolve();
        }

        // Create a connection reference to our Azure Mobile Apps backend 
        client = new WindowsAzure.MobileServiceClient('https://yoursitename.azurewebsites.net');

        // Create the sqlite store
        store = new WindowsAzure.MobileServiceSqliteStore();

        // Define the table schema and initialize sync context
        return store
                .defineTable({
                    name: tableName,
                    columnDefinitions: {
                        id: 'string',
                        deleted: 'boolean',
                        text: 'string',
                        version: 'string',
                        complete: 'boolean'
                    }
                })
                .then(function() {
                    syncContext = client.getSyncContext();
                    syncContext.pushHandler = {
                        onConflict: onConflict,
                        onError: function (pushError) {
                            // Treat 404 as a conflict. This can happen if server deletes a record and client pushes an updated value of the record
                            if (pushError.getError().request.status === 404) {
                                return onConflict(pushError);
                            }

                            return handleError(pushError, 'Encountered error while pushing change to server. Possibly connectivity issue!');
                        }
                    };
                    return syncContext.initialize(store);
                })
                .then(function() {
                    table = client.getSyncTable(tableName);
                    isInitialized = true;
                });
    }

    function onConflict(pushError) {

        switch(pushError.getAction()) {
            case 'insert':
                return handleInsertConflict(pushError);
            case 'update':
                return handleUpdateConflict(pushError);
            case 'delete':
                return handleDeleteConflict(pushError);
        }

        return handleError('Unhandled conflict!')
    }

    function handleInsertConflict(pushError) {
        // As the record ID is a GUID, a conflict here means that the client
        // pushed the record to the server in the past but the change was 
        // not removed from the pending operations queue, thus pushing it again.
        // We simply cancel this change from being pushed again.
        return pushError.cancel();
    }

    function handleUpdateConflict(pushError) {
        var serverRecord = pushError.getServerRecord(),
            clientRecord = pushError.getClientRecord(),
            status = pushError.getError().request.status;
            
        if (status === 404) { // Either the server record never existed or has been deleted
                              // In either case, we cancel the update.
            return pushError.cancelAndDiscard();
        }

        if (serverRecord && clientRecord) { // Server and client have conflicting changes to the record

            // If the client and server records are identical, just ignore
            // the conflict and discard the pending change
            if (serverRecord.text === clientRecord.text &&
                serverRecord.complete === clientRecord.complete &&
                serverRecord.deleted === clientRecord.deleted) {

                return pushError.cancelAndDiscard();
            }

            // Involve the user in conflict resolution
            return uiManager
                    .resolve(clientRecord)
                    .then(function(result) {
                        if (result === 'skip') { // skip resolving this conflict
                            return;
                        }

                        if (result === 'server') { // use the server value to resolve the conflict
                            return pushError.cancelAndUpdate(serverRecord);
                        }
                        
                        if (result === 'client') { // use the client value to resolve the conflict
                            result = clientRecord;
                        } else { // if result is not one of 'server', 'client', 'skip', we assume the user has provided a custom value for the record
                            result.id = serverRecord.id; // The custom value specified by the user need not have ID. We set it explicitly
                        }

                        result.version = serverRecord.version; // Update the version in the record to match the server version
                        return pushError.update(result);
                    });
        }
    }

    function handleDeleteConflict(pushError) {

        var status = pushError.getError().request.status,
            serverRecord = pushError.getServerRecord();

        // If the server record never existed, status code will be 404
        // If the server record has been deleted, the status code could be 404, 409 or 412 based on the scenario
        // The node and .net backends need to be fixed so that the behavior be consistent.
        // For now, we simply check for all possible status codes
        if (status === 404 || status === 409 || (status === 412 && serverRecord.deleted)) {
            return pushError.cancelAndDiscard();
        }

        // server updated, client deleted. so discard client change and update client record as per server value
        if (status === 412 && !serverRecord.deleted) {
            return pushError.changeAction('update', serverRecord);
        }

        return handleError(pushError, 'All possible errors were handled. We do not expect to be here ever!');
    }


    /** 
     * Gets a reference to the local table
     */
    function getTable() {
        return setup()
                .then(function() {
                    return table;
                });
    }

    /**
     * Pushes local changes and pulls server data
     */
    function refresh(query) {
        return setup()
                .then(function() {
                    return push();
                }).then(function() {
                    return table.pull(query);
                });
    }

    /**
     * Pulls the table data from the server
     */
    function pull(query) {
        return setup()
                .then(function() {
                    return table.pull(query);
                }).then(undefined, function(pushError) {
                    return handleError(pushError, 'Pull failed. Error: ' + pushError.message);
                });
    }

    /**
     * Pushes the local changes to the server
     */
    function push() {
        return setup()
                .then(function() {
                    return syncContext.push();
                })
                .then(function(conflicts) {
                    if (conflicts.length > 0) {
                        return uiManager.updateSummaryMessage('Push completed with ' + conflicts.length + ' conflict(s)');
                    }
                }, function(pushError) {
                    return handleError(pushError, 'Push failed. Error: ' + pushError.message);
                });
    }

    function handleError(pushError, message) {
        uiManager.updateSummaryMessage(message);

        return Promise.reject(new Error(message));
    } 

    return {
        getTable: getTable,
        pull: pull,
        refresh: refresh,
        setUiManager: setUiManager
    }
});
