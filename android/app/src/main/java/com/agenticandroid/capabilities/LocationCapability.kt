// UNVERIFIED — compiles only with Android SDK + JDK 17/21 + device. See DESIGN.md § Build status.
package com.agenticandroid.capabilities

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.agenticandroid.CapResult
import com.agenticandroid.Capability
import com.agenticandroid.Sensitivity
import com.agenticandroid.typedError
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Mirrors phone-sim.ts `location.get`.
 *
 * Uses FusedLocationProviderClient for a single best-available fix, returned as:
 *   { lat: Double, lon: Double, accuracy_m: Float }
 *
 * Sensitivity is ALLOW (same as the TS sim default — location is low-consequential here because
 * the agent already has persistent device access; the consent model handles per-agent policy).
 *
 * Required manifest permission: android.permission.ACCESS_FINE_LOCATION (already in AndroidManifest.xml).
 *
 * TODO (device wiring):
 *   - getLastKnownLocation is fast but may be null if the device has never fixed.
 *     In that case requestSingleUpdate (scaffolded below) fires a real GPS/network fix.
 *   - Handle SecurityException on API-level downgrade gracefully.
 */
class LocationCapability(private val context: Context) : Capability {
    override val method      = "location.get"
    override val sensitivity = Sensitivity.ALLOW
    override val summary     = "Get current GPS location."

    private val fusedClient by lazy { LocationServices.getFusedLocationProviderClient(context) }

    override suspend fun execute(params: JsonObject): CapResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return typedError("PERMISSION_NOT_GRANTED", "ACCESS_FINE_LOCATION permission not granted")
        }

        return withContext(Dispatchers.IO) {
            try {
                val location = getLocation()
                CapResult(result = buildJsonObject {
                    put("lat",        location.latitude)
                    put("lon",        location.longitude)
                    put("accuracy_m", location.accuracy)
                })
            } catch (e: Exception) {
                typedError("LOCATION_UNAVAILABLE", e.message ?: "location fix failed")
            }
        }
    }

    /**
     * Returns the best available fix: last-known if fresh, otherwise a fresh single-update request.
     *
     * TODO: tune freshness threshold (currently anything non-null from getLastLocation is accepted).
     * For stricter freshness, compare location.time against System.currentTimeMillis() and fall
     * through to requestSingleUpdate if the fix is older than, say, 30 s.
     */
    private suspend fun getLocation(): Location {
        // Try last-known first (instant, battery-free).
        val lastKnown = CompletableDeferred<Location?>()
        fusedClient.lastLocation
            .addOnSuccessListener { lastKnown.complete(it) }
            .addOnFailureListener { lastKnown.completeExceptionally(it) }
        val last = lastKnown.await()
        if (last != null) return last

        // No cached fix — request a fresh one.
        return requestSingleUpdate()
    }

    private suspend fun requestSingleUpdate(): Location {
        val deferred = CompletableDeferred<Location>()
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 0L)
            .setMaxUpdates(1)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation
                if (loc != null) deferred.complete(loc)
                else deferred.completeExceptionally(IllegalStateException("null location in callback"))
                fusedClient.removeLocationUpdates(this)
            }
        }
        // TODO: ensure Looper.getMainLooper() is acceptable here; alternatively use a HandlerThread.
        fusedClient.requestLocationUpdates(req, cb, Looper.getMainLooper())
        return deferred.await()
    }
}
